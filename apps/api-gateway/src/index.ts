/**
 * API Gateway for Kayak-like Travel Booking System
 * Routes requests to appropriate microservices with caching, rate limiting, and monitoring
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import CircuitBreaker from 'opossum';
import { collectDefaultMetrics, register, Counter, Histogram } from 'prom-client';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse, HealthCheck, generateTraceId } from '@kayak/shared';

class ApiGateway {
  public app: express.Application;
  private redisClient: any;
  private port: number;
  private services: { [key: string]: string } = {};
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private promMetrics!: {
    requestsTotal: Counter<string>;
    requestDuration: Histogram<string>;
    errorsTotal: Counter<string>;
  };
  private wsProxy: any;
  private initialized: boolean = false;
  private readonly healthCheckIntervalMs: number = Number(process.env.SERVICE_HEALTH_INTERVAL_MS) || 15000;

  constructor() {
    this.app = express();
    this.port = Number(process.env.PORT) || 8000;
    
    // Service URLs
    this.services = {
      'user': process.env.USER_SVC_URL || 'http://localhost:8001',
      'flights': process.env.FLIGHTS_SVC_URL || 'http://localhost:8002',
      'hotels': process.env.HOTELS_SVC_URL || 'http://localhost:8003',
      'cars': process.env.CARS_SVC_URL || 'http://localhost:8004',
      'billing': process.env.BILLING_SVC_URL || 'http://localhost:8005',
      'admin': process.env.ADMIN_SVC_URL || 'http://localhost:8006',
      'concierge': process.env.CONCIERGE_SVC_URL || 'http://localhost:8007',
      'deals': process.env.DEALS_WORKER_URL || 'http://localhost:8008',
      'notifications': process.env.NOTIFICATION_SVC_URL || 'http://localhost:8009',
      'airports': process.env.AIRPORT_RESOLVER_URL || 'http://localhost:8010',
      'bookings': process.env.BOOKING_SVC_URL || 'http://localhost:8011'
    };
  }

  public async init() {
    try {
      await this.initializeRedis();
      this.initPrometheus();
      this.setupMiddleware();
      this.initializeCircuitBreakers();
      this.setupRoutes();
      this.setupErrorHandling();
      this.initialized = true;
      console.log('✅ API Gateway initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize API Gateway:', error);
      throw error;
    }
  }

  private initPrometheus() {
    // Collect default Node.js metrics
    collectDefaultMetrics({ register });
    
    // Custom metrics
    this.promMetrics = {
      requestsTotal: new Counter({
        name: 'gateway_requests_total',
        help: 'Total number of requests processed',
        labelNames: ['service', 'method', 'status'] as const,
        registers: [register]
      }),
      requestDuration: new Histogram({
        name: 'gateway_request_duration_seconds',
        help: 'Duration of requests in seconds',
        labelNames: ['service'] as const,
        buckets: [0.1, 0.5, 1, 2, 5, 10],
        registers: [register]
      }),
      errorsTotal: new Counter({
        name: 'gateway_errors_total',
        help: 'Total number of errors',
        labelNames: ['service', 'error_type'] as const,
        registers: [register]
      })
    };
    console.log('✅ Prometheus metrics initialized');
  }

  private async initializeRedis() {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      this.redisClient.on('error', (err: any) => console.error('Redis Client Error', err));
      await this.redisClient.connect();
      console.log('✅ Redis connected');
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
    }
  }

  private async initializeCircuitBreakers() {
    const circuitBreakerOptions = {
      timeout: 3000, // 3 second timeout
      errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
      resetTimeout: 30000, // Try again after 30 seconds
      rollingCountTimeout: 10000, // Rolling window of 10 seconds
      rollingCountBuckets: 10, // 10 buckets in the rolling window
      volumeThreshold: 5 // Only open circuit if at least 5 requests in the window
    };

    // Create circuit breakers for each service
    Object.entries(this.services).forEach(([serviceName, serviceUrl]) => {
      const breaker = new CircuitBreaker(
        () => this.checkServiceHealth(serviceUrl),
        circuitBreakerOptions
      );
      
      breaker.on('open', () => {
        console.error(`Circuit breaker OPEN for ${serviceName}`);
        this.promMetrics.errorsTotal.inc({ service: serviceName, error_type: 'circuit_breaker_open' });
      });
      
      breaker.on('halfOpen', () => {
        console.log(`Circuit breaker HALF-OPEN for ${serviceName}`);
      });
      
      breaker.on('close', () => {
        console.log(`Circuit breaker CLOSED for ${serviceName}`);
      });
      
      this.circuitBreakers.set(serviceName, breaker);

      // Kick off periodic health checks so the breaker reflects live service status
      const runHealthCheck = () => breaker.fire().catch(() => {});
      runHealthCheck();
      setInterval(runHealthCheck, this.healthCheckIntervalMs);
    });
    
    console.log('✅ Circuit breakers initialized for all services');
  }

  private async checkServiceHealth(serviceUrl: string): Promise<any> {
    const response = await fetch(`${serviceUrl}/health`);
    if (!response.ok) {
      throw new Error(`Service health check failed: ${response.status}`);
    }
    return response.json();
  }

  private createProxiedRoute(serviceName: string, targetService: string) {
    const proxy = createProxyMiddleware({
      target: this.services[targetService],
      changeOrigin: true,
      // Rewrite paths so that:
      // - Health checks hit service root health (e.g., /api/hotels/health -> /health)
      // - Other routes keep the service segment (e.g., /api/hotels/search -> /hotels/search)
      pathRewrite: (path: string, req: express.Request) => {
        const base = (req as any).baseUrl || '';
        const remainder = path.startsWith(base) ? path.slice(base.length) : path;
        if (remainder.startsWith('/health')) {
          return '/health';
        }
        return path.replace(/^\/api/, '');
      },
      onProxyReq: (proxyReq: any, req: express.Request) => {
        this.proxyRequestHandler(proxyReq, req, serviceName);
      },
      onError: (err: any, req: express.Request, res: express.Response) => {
        // Record failure in circuit breaker
        const breaker = this.circuitBreakers.get(serviceName);
        if (breaker) {
          breaker.fire().catch(() => {}); // Ignore breaker errors
        }
        this.proxyErrorHandler(err, req, res);
      },
      onProxyRes: (proxyRes: any, req: express.Request, res: express.Response) => {
        // Track metrics on response
        const pathParts = req.path.split('/');
        const service = pathParts[2] || 'unknown';
        const startTime = (req as any).startTime || Date.now();
        const duration = (Date.now() - startTime) / 1000;
        
        // Record request in circuit breaker
        const breaker = this.circuitBreakers.get(serviceName);
        if (breaker && proxyRes.statusCode < 500) {
          breaker.fire().catch(() => {}); // Success for circuit breaker
        } else if (breaker && proxyRes.statusCode >= 500) {
          breaker.fire().catch(() => {}); // Failure for circuit breaker
        }
        
        this.promMetrics.requestsTotal.inc({
          service,
          method: req.method,
          status: proxyRes.statusCode.toString()
        });
        
        this.promMetrics.requestDuration.observe({ service }, duration);
        
        if (proxyRes.statusCode >= 400) {
          this.promMetrics.errorsTotal.inc({
            service,
            error_type: 'http_error'
          });
        }
      }
    });

    return proxy;
  }

  private setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request tracing
    this.app.use((req, res, next) => {
      const traceId = req.headers['x-trace-id'] as string || generateTraceId();
      (req as any).traceId = traceId;
      res.setHeader('X-Trace-Id', traceId);
      next();
    });

    // Rate limiting middleware
    this.app.use(this.rateLimiter.bind(this));
    
    // Auth middleware (verify tokens)
    this.app.use(this.verifyToken.bind(this));
  }

  private async rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!this.redisClient || !(this.redisClient as any).isReady) {
      return next();
    }

    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const path = req.path;
    
    // Different limits for different endpoints
    let limit = 100; // default: 100 requests per minute
    let window = 60; // 1 minute window
    
    // Search endpoints - higher rate
    if (path.includes('/api/flights/search') || path.includes('/api/hotels/search') || path.includes('/api/cars/search')) {
      limit = 30;
    }
    
    // Auth endpoints - lower rate (prevent brute force)
    if (path.includes('/auth/login') || path.includes('/auth/register')) {
      limit = 5;
      window = 300; // 5 minutes for auth
    }
    
    // Admin endpoints - strict rate
    if (path.includes('/api/admin')) {
      limit = 20;
    }
    
    const key = `rate_limit:${clientIp}:${path.split('/')[2] || 'default'}`;
    
    try {
      const current = await this.redisClient.incr(key);
      if (current === 1) {
        await this.redisClient.expire(key, window);
      }
      
      if (current > limit) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            traceId: (req as any).traceId
          }
        });
      }
      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      next(); // Continue if Redis fails
    }
  }

  private verifyToken(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (this.isPublicRequest(req)) {
      return next();
    }
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'No token provided',
          traceId: (req as any).traceId
        }
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'CONFIG_ERROR',
            message: 'JWT_SECRET environment variable is required'
          }
        });
      }
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      ) as any;
      
      // Attach user info to request
      (req as any).userId = decoded.userId;
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
          traceId: (req as any).traceId
        }
      });
    }
  }

  private isPublicRequest(req: express.Request): boolean {
    const path = req.path;
    const method = req.method.toUpperCase();

    if (path === '/health' || path === '/metrics' || path === '/' || path.startsWith('/docs') || path.startsWith('/ws')) {
      return true;
    }

    if (path.startsWith('/api/auth') || path.startsWith('/api/airports')) {
      return true;
    }

    if (path === '/api/deals/recommendations') {
      return true;
    }

    if (method === 'GET') {
      if (/^\/api\/(flights|hotels|cars)\/search/.test(path)) {
        return true;
      }
      if (/^\/api\/flights\/route\//.test(path)) {
        return true;
      }
      if (/^\/api\/(flights|hotels|cars)\/[^/]+$/.test(path)) {
        return true;
      }
    }

    return false;
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', this.healthCheck.bind(this));
    
    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    });

    // WebSocket proxy to concierge /events
    this.wsProxy = createProxyMiddleware({
      target: this.services['concierge'],
      changeOrigin: true,
      ws: true,
      pathRewrite: (path: string) => path.replace(/^\/ws/, '/events'),
      onProxyReq: (proxyReq: any, req: express.Request) => {
        this.proxyRequestHandler(proxyReq, req, 'concierge');
      },
      onError: (err: any, req: express.Request, res: express.Response) => {
        this.proxyErrorHandler(err, req, res);
      }
    });
    this.app.use('/ws', this.wsProxy);

    // User service routes with circuit breaker protection
    this.app.use('/api/users', this.circuitBreakerGuard('user'), this.createProxiedRoute('user', 'user'));
    this.app.use('/api/auth', this.circuitBreakerGuard('user'), this.createProxiedRoute('user', 'user'));

    // Flights service routes with circuit breaker protection
    this.app.use('/api/flights', this.circuitBreakerGuard('flights'), this.createProxiedRoute('flights', 'flights'));

    // Hotels service routes with circuit breaker protection
    this.app.use('/api/hotels', this.circuitBreakerGuard('hotels'), this.createProxiedRoute('hotels', 'hotels'));

    // Cars service routes with circuit breaker protection
    this.app.use('/api/cars', this.circuitBreakerGuard('cars'), this.createProxiedRoute('cars', 'cars'));

    // Billing service routes with circuit breaker protection
    this.app.use('/api/billing', this.circuitBreakerGuard('billing'), this.createProxiedRoute('billing', 'billing'));

    // Admin service routes with circuit breaker protection
    this.app.use('/api/admin', this.circuitBreakerGuard('admin'), this.createProxiedRoute('admin', 'admin'));

    // Analytics passthrough (client posts to /api/analytics/*)
    this.app.use('/api/analytics', this.circuitBreakerGuard('admin'), this.createProxiedRoute('admin', 'admin'));

    // Concierge service routes with circuit breaker protection
    this.app.use('/api/concierge', this.circuitBreakerGuard('concierge'), this.createProxiedRoute('concierge', 'concierge'));

    // Deals recommendations endpoint (fronts concierge /concierge/deals)
    this.app.get('/api/deals/recommendations', async (req, res) => {
      try {
        const traceId = (req as any).traceId || generateTraceId();
        const limit = req.query.limit ? Number(req.query.limit) : 10;
        const destination = req.query.destination as string | undefined;
        const conciergeUrl = this.services['concierge'] || 'http://localhost:8007';

        const url = new URL('/concierge/deals', conciergeUrl);
        if (destination) {
          url.searchParams.set('destination', destination);
        }

        const response = await fetch(url.toString(), {
          headers: {
            'X-Trace-Id': traceId
          }
        });

        if (!response.ok) {
          const text = await response.text();
          console.error('[GATEWAY] /api/deals/recommendations upstream error:', response.status, text);
          return res.status(502).json({
            success: false,
            error: {
              code: 'BAD_GATEWAY',
              message: 'Failed to load deal recommendations',
              traceId
            }
          });
        }

        const body = await response.json() as any;
        const deals = body?.data?.deals || [];
        const sliced = deals.slice(0, limit);

        return res.json({
          success: true,
          data: { deals: sliced },
          traceId
        });
      } catch (err: any) {
        console.error('[GATEWAY] /api/deals/recommendations error:', err?.message || err);
        return res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to load deal recommendations',
            traceId: (req as any).traceId || generateTraceId()
          }
        });
      }
    });

    // Deals service routes with circuit breaker protection (other endpoints, if any)
    this.app.use('/api/deals', this.circuitBreakerGuard('deals'), this.createProxiedRoute('deals', 'deals'));

    // Notification service routes with circuit breaker protection  
    this.app.use('/api/notifications', this.circuitBreakerGuard('notifications'), this.createProxiedRoute('notifications', 'notifications'));

    // Booking service routes with circuit breaker protection
    this.app.use('/api/bookings', this.circuitBreakerGuard('bookings'), this.createProxiedRoute('bookings', 'bookings'));

    // Airport resolver service routes with circuit breaker protection
    this.app.use('/api/airports', this.circuitBreakerGuard('airports'), this.createProxiedRoute('airports', 'airports'));

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        data: {
          name: 'Kayak API Gateway',
          version: '1.0.0',
          services: Object.keys(this.services),
          documentation: '/docs'
        }
      });
    });
  }

  private proxyRequestHandler(proxyReq: any, req: express.Request, serviceName: string) {
    // Add trace ID to proxied requests
    const traceId = (req as any).traceId;
    if (traceId) {
      proxyReq.setHeader('X-Trace-Id', traceId);
    }

    // Add user ID to proxied requests
    const userId = (req as any).userId;
    if (userId) {
      proxyReq.setHeader('X-User-Id', userId);
    }

    // Add idempotency key if present
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    if (idempotencyKey) {
      proxyReq.setHeader('X-Idempotency-Key', idempotencyKey);
    }
    
    // Store start time for metrics
    (req as any).startTime = Date.now();
    
    // Log proxy requests
    console.log(`[GATEWAY] ${req.method} ${req.path} -> ${proxyReq.path}`);

    // Forward JSON body for non-GET methods (body was parsed by express.json())
    try {
      const method = (req.method || 'GET').toUpperCase();
      const hasBody = req.body && Object.keys(req.body).length > 0;
      if (method !== 'GET' && method !== 'HEAD' && hasBody) {
        const contentType = req.headers['content-type'] || 'application/json';
        const bodyData = contentType.toString().includes('application/json')
          ? JSON.stringify(req.body)
          : (req as any).rawBody || '';
        if (bodyData && typeof bodyData === 'string') {
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      }
    } catch (e) {
      console.error('[GATEWAY] Failed to forward request body:', (e as any)?.message);
    }
  }

  private proxyErrorHandler(err: any, req: express.Request, res: express.Response) {
    console.error(`[GATEWAY] Proxy error for ${req.path}:`, err.message);
    this.promMetrics.errorsTotal.inc({
      service: req.path.split('/')[2] || 'unknown',
      error_type: 'bad_gateway'
    });
    res.status(502).json({
      success: false,
      error: {
        code: 'BAD_GATEWAY',
        message: 'Service temporarily unavailable',
        traceId: (req as any).traceId
      }
    });
  }

  private circuitBreakerGuard(serviceName: string) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const breaker = this.circuitBreakers.get(serviceName);
      if (breaker && breaker.opened) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: `Service ${serviceName} is temporarily unavailable`,
            traceId: (req as any).traceId
          }
        });
      }
      next();
    };
  }

  private async healthCheck(req: express.Request, res: express.Response) {
    const health: HealthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'api-gateway',
      version: '1.0.0',
      checks: {}
    };

    // Check Redis
    try {
      if (this.redisClient && (this.redisClient as any).isReady) {
        health.checks.cache = 'healthy';
      } else {
        health.checks.cache = 'unhealthy';
        health.status = 'unhealthy';
      }
    } catch (error) {
      health.checks.cache = 'unhealthy';
      health.status = 'unhealthy';
    }

    res.json({ success: true, data: health });
  }

  private setupErrorHandling() {
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('[GATEWAY] Unhandled error:', err);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          traceId: (req as any).traceId
        }
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route ${req.method} ${req.originalUrl} not found`,
          traceId: (req as any).traceId
        }
      });
    });
  }

  public start() {
    if (!this.initialized) {
      throw new Error('API Gateway must be initialized before calling start()');
    }
    const server = this.app.listen(this.port, () => {
      console.log(`🚀 API Gateway listening on port ${this.port}`);
      console.log(`📍 Health check: http://localhost:${this.port}/health`);
      console.log(`📖 API docs: http://localhost:${this.port}/docs`);
      
      // Log service endpoints
      console.log('\n🔗 Service Endpoints:');
      Object.entries(this.services).forEach(([name, url]) => {
        console.log(`   ${name}: ${url}`);
      });
    });

    // Enable WebSocket upgrade handling for /ws proxy
    server.on('upgrade', (req: any, socket: any, head: any) => {
      const url = req.url || '';
      if (url.startsWith('/ws') && this.wsProxy && typeof this.wsProxy.upgrade === 'function') {
        this.wsProxy.upgrade(req, socket, head);
      }
    });
  }
}

// Start the gateway
const gateway = new ApiGateway();

// Export for testing
export const app = gateway.app;

// Start the gateway if this file is run directly
if (require.main === module) {
  (async () => {
    try {
      await gateway.init();
      gateway.start();
    } catch (error) {
      console.error('❌ API Gateway failed to start', error);
      process.exit(1);
    }
  })();
}
