import express from 'express';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { generateTraceId } from '@kayak/shared';
import jwt from 'jsonwebtoken';
import { Kafka, Producer } from 'kafkajs';

const RevenueAnalytics = require('./analytics/revenueAnalytics') as any;
const UserAnalytics = require('./analytics/userAnalytics') as any;
const BookingAnalytics = require('./analytics/bookingAnalytics') as any;
const DealAnalytics = require('./analytics/dealAnalytics') as any;

class AdminService {
  private app: express.Application;
  private db!: mysql.Pool;
  private mongo!: MongoClient;
  private port = 8006;
  private revenueAnalytics: any;
  private userAnalytics: any;
  private bookingAnalytics: any;
  private dealAnalytics: any;
  private dbCoreName = 'kayak';
  private dbAnalyticsName = 'kayak';
  private kafkaProducer?: Producer;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      const traceId = (req.headers['x-trace-id'] as string) || generateTraceId();
      (req as any).traceId = traceId;
      res.setHeader('X-Trace-Id', traceId);
      next();
    });
    this.initializeDatabase();
    this.setupRoutes();
  }

  private async initializeDatabase() {
    this.db = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'kayak',
      password: process.env.DB_PASSWORD || 'change_me_db_password',
      database: process.env.DB_NAME || 'kayak',
      connectionLimit: 50
    });

    // Initialize MongoDB for analytics
    this.mongo = new MongoClient(process.env.MONGODB_URL || 'mongodb://root:change_me_mongo_root_password@localhost:27017');
    await this.mongo.connect();

    this.revenueAnalytics = new RevenueAnalytics(this.mongo);
    this.userAnalytics = new UserAnalytics(this.mongo);
    this.bookingAnalytics = new BookingAnalytics(this.mongo);
    this.dealAnalytics = new DealAnalytics(this.mongo);

    // Best-effort bootstrap of analytics collections from core MySQL data so that
    // admin dashboards and reports have meaningful aggregates even on a fresh system.
    await this.bootstrapAnalyticsCollections();

    // Initialize Kafka producer for clickstream, if configured
    const brokersEnv = process.env.KAFKA_BROKERS;
    if (brokersEnv) {
      try {
        const kafka = new Kafka({
          clientId: 'admin-svc',
          brokers: brokersEnv.split(','),
        });
        const producer = kafka.producer();
        await producer.connect();
        this.kafkaProducer = producer;
        console.log('✅ Admin Kafka producer connected for clickstream.events');
      } catch (err) {
        console.error('❌ Failed to initialize admin Kafka producer:', err);
      }
    } else {
      console.log('ℹ️  KAFKA_BROKERS not configured for admin-svc; skipping Kafka producer');
    }

    console.log('✅ Admin MySQL pool and MongoDB connected');
  }

  // Authentication middleware for admin routes
  private async requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
      }

      const token = authHeader.split(' ')[1];
      const secret = process.env.JWT_SECRET;

      if (!secret) {
        console.error('[admin-svc] JWT_SECRET is not configured');
        return res.status(500).json({
          success: false,
          error: {
            code: 'CONFIG_ERROR',
            message: 'JWT_SECRET is not configured for admin service'
          }
        });
      }
      
      try {
        const decoded = jwt.verify(token, secret) as any;
        
        // Verify user is admin
        const [rows] = await this.db.execute(
          'SELECT id, email, role FROM users WHERE id = ?',
          [decoded.userId]
        );
        const user = (rows as any[])[0];
        
        if (!user) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid token'
            }
          });
        }
        
        if (user.role !== 'admin') {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Admin access required'
            }
          });
        }
        
        (req as any).user = user;
        next();
      } catch (jwtError) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token'
          }
        });
      }
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authentication error'
        }
      });
    }
  }

  /**
   * Seed MongoDB analytics collections (bookings, users, deals) from the core MySQL
   * schema when they are empty. This keeps the admin analytics endpoints functional
   * without requiring a separate ETL pipeline.
   */
  private async bootstrapAnalyticsCollections() {
    try {
      const analyticsDb = this.mongo.db(this.dbAnalyticsName);
      const bookingsCol = analyticsDb.collection('bookings');
      const usersCol = analyticsDb.collection('users');
      const dealsCol = analyticsDb.collection('deals');

      // Seed bookings collection
      const bookingCount = await bookingsCol.estimatedDocumentCount();
      if (bookingCount === 0) {
        const [bookingRows] = await this.db.query(
          `SELECT id, user_id, type, status, total_amount, currency, created_at, trip_start_date, trip_end_date
           FROM bookings
           ORDER BY created_at DESC
           LIMIT 10000`
        );
        const [itemRows] = await this.db.query(
          `SELECT booking_id, type, quantity, total_price
           FROM booking_items`
        );

        const itemsByBooking: Record<string, any[]> = {};
        (itemRows as any[]).forEach((row) => {
          const list = itemsByBooking[row.booking_id] || (itemsByBooking[row.booking_id] = []);
          list.push({
            type: row.type,
            quantity: row.quantity,
            price: Number(row.total_price),
          });
        });

        if ((bookingRows as any[]).length > 0) {
          const docs = (bookingRows as any[]).map((row: any) => ({
            booking_id: row.id,
            user_id: row.user_id,
            status: row.status,
            type: row.type,
            total_amount: Number(row.total_amount),
            currency: row.currency,
            created_at: new Date(row.created_at),
            trip_start_date: row.trip_start_date ? new Date(row.trip_start_date) : null,
            trip_end_date: row.trip_end_date ? new Date(row.trip_end_date) : null,
            items: itemsByBooking[row.id] || [],
          }));
          if (docs.length > 0) {
            await bookingsCol.insertMany(docs);
          }
        }
      }

      // Seed users collection
      const userCount = await usersCol.estimatedDocumentCount();
      if (userCount === 0) {
        const [userRows] = await this.db.query(
          `SELECT id, email, first_name, last_name, date_of_birth, created_at
           FROM users
           LIMIT 10000`
        );
        const [addressRows] = await this.db.query(
          `SELECT user_id, city, state
           FROM user_addresses`
        );
        const addressByUser: Record<string, any> = {};
        (addressRows as any[]).forEach((row) => {
          if (!addressByUser[row.user_id]) {
            addressByUser[row.user_id] = row;
          }
        });

        if ((userRows as any[]).length > 0) {
          const docs = (userRows as any[]).map((row: any) => {
            const addr = addressByUser[row.id] || {};
            const dob = row.date_of_birth ? new Date(row.date_of_birth) : null;
            const age =
              dob != null
                ? Math.max(
                    18,
                    new Date().getFullYear() - (dob.getFullYear() || new Date().getFullYear())
                  )
                : 30;
            return {
              user_id: row.id,
              email: row.email,
              first_name: row.first_name,
              last_name: row.last_name,
              age,
              gender: 'unknown',
              city: addr.city || null,
              state: addr.state || null,
              user_type: 'traveler',
              created_at: new Date(row.created_at),
              last_activity: new Date(),
            };
          });
          if (docs.length > 0) {
            await usersCol.insertMany(docs);
          }
        }
      }

      // Seed deals collection from core MySQL deals table
      const dealsCount = await dealsCol.estimatedDocumentCount();
      if (dealsCount === 0) {
        const [dealRows] = await this.db.query(
          `SELECT id, type, reference_id, original_price, deal_price, discount, currency, valid_until, tags, score, created_at
           FROM deals
           LIMIT 10000`
        );
        if ((dealRows as any[]).length > 0) {
          const docs = (dealRows as any[]).map((row: any) => ({
            deal_id: row.id,
            deal_type: row.type,
            reference_id: row.reference_id,
            original_price: Number(row.original_price),
            deal_price: Number(row.deal_price),
            discount_percentage: Number(row.discount),
            currency: row.currency,
            valid_until: new Date(row.valid_until),
            created_at: new Date(row.created_at),
            tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : [],
            ai_score: Number(row.score ?? 0),
            conversion_rate: 0,
            revenue_impact: 0,
          }));
          await dealsCol.insertMany(docs);
        }
      }
    } catch (err) {
      console.error('Admin analytics bootstrap failed:', err);
    }
  }

  private setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ success: true, data: { status: 'healthy', service: 'admin-svc', timestamp: new Date().toISOString() } });
    });

    // Basic admin stats - protected
    this.app.get('/admin/stats', this.requireAdmin.bind(this), async (req, res) => {
      const [users] = await this.db.query('SELECT COUNT(*) as c FROM users');
      const [bookings] = await this.db.query('SELECT COUNT(*) as c FROM bookings');
      const [flights] = await this.db.query('SELECT COUNT(*) as c FROM flights');
      const [hotels] = await this.db.query('SELECT COUNT(*) as c FROM hotels');
      const [cars] = await this.db.query('SELECT COUNT(*) as c FROM car_rentals');
      res.json({ success: true, data: { users: (users as any)[0].c, bookings: (bookings as any)[0].c, flights: (flights as any)[0].c, hotels: (hotels as any)[0].c, cars: (cars as any)[0].c } });
    });

    // Analytics endpoints - protected
    this.app.get('/admin/analytics/revenue', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const timeRange = req.query.timeRange as string || 'last_30d';
        
        // Calculate date range
        let daysAgo = 30;
        if (timeRange === 'last_7d') daysAgo = 7;
        else if (timeRange === 'last_90d') daysAgo = 90;
        
        // Top properties by revenue
        const [topProperties] = await this.db.query(`
          SELECT 
            h.name,
            h.address_city as city,
            h.address_state as state,
            COUNT(DISTINCT bi.booking_id) as bookings,
            SUM(bi.total_price) as revenue
          FROM booking_items bi
          JOIN hotel_rooms hr ON bi.reference_id = hr.id AND bi.type = 'hotel'
          JOIN hotels h ON hr.hotel_id = h.id
          JOIN bookings b ON bi.booking_id = b.id
          WHERE b.status IN ('confirmed', 'completed') 
            AND b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          GROUP BY h.id, h.name, h.address_city, h.address_state
          ORDER BY revenue DESC
          LIMIT 10
        `, [daysAgo]);

        // City-wise revenue
        const [cityRevenue] = await this.db.query(`
          SELECT 
            h.address_city as city,
            h.address_state as state,
            COUNT(DISTINCT bi.booking_id) as bookings,
            SUM(bi.total_price) as revenue
          FROM booking_items bi
          JOIN hotel_rooms hr ON bi.reference_id = hr.id AND bi.type = 'hotel'
          JOIN hotels h ON hr.hotel_id = h.id
          JOIN bookings b ON bi.booking_id = b.id
          WHERE b.status IN ('confirmed', 'completed')
            AND b.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          GROUP BY h.address_city, h.address_state
          ORDER BY revenue DESC
          LIMIT 20
        `, [daysAgo]);

        // Total revenue
        const [totalRev] = await this.db.query(`
          SELECT SUM(total_amount) as total
          FROM bookings
          WHERE status IN ('confirmed', 'completed')
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [daysAgo]);

        const data = {
          topProperties,
          cityRevenue,
          totalRevenue: (totalRev as any)[0]?.total || 0,
          timeRange
        };
        
        res.json({ success: true, data });
      } catch (error) {
        console.error('Revenue analytics error:', error);
        res.status(500).json({ success: false, error: { code: 'ANALYTICS_ERROR', message: 'Failed to load revenue analytics' } });
      }
    });

    this.app.get('/admin/analytics/users', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const timeRange = req.query.timeRange as string || 'last_30d';
        const data = await this.userAnalytics.getUserAnalytics(timeRange);
        res.json({ success: true, data });
      } catch (error) {
        console.error('User analytics error:', error);
        res.status(500).json({ success: false, error: { code: 'ANALYTICS_ERROR', message: 'Failed to load user analytics' } });
      }
    });

    this.app.get('/admin/analytics/bookings', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const timeRange = req.query.timeRange as string || 'last_30d';
        const groupBy = req.query.groupBy as string || 'day';
        const data = await this.bookingAnalytics.getBookingTrends(timeRange, groupBy);
        res.json({ success: true, data });
      } catch (error) {
        console.error('Booking analytics error:', error);
        res.status(500).json({ success: false, error: { code: 'ANALYTICS_ERROR', message: 'Failed to load booking analytics' } });
      }
    });

    this.app.get('/admin/analytics/deals', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const timeRange = req.query.timeRange as string || 'last_30d';
        const includeAIEffectiveness = req.query.includeAIEffectiveness === 'true';
        const data = await this.dealAnalytics.getDealPerformance(timeRange, includeAIEffectiveness);
        res.json({ success: true, data });
      } catch (error) {
        console.error('Deal analytics error:', error);
        res.status(500).json({ success: false, error: { code: 'ANALYTICS_ERROR', message: 'Failed to load deal analytics' } });
      }
    });

    this.app.get('/admin/analytics/performance', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const includeServiceMetrics = req.query.includeServiceMetrics === 'true';
        const includeErrorRates = req.query.includeErrorRates === 'true';
        
        // Performance metrics would come from monitoring systems
        const data = {
          responseTimes: {
            flights: { avg: 150, p95: 300 },
            hotels: { avg: 120, p95: 250 },
            cars: { avg: 100, p95: 200 },
            concierge: { avg: 200, p95: 500 }
          },
          errorRates: {
            flights: 0.02,
            hotels: 0.015,
            cars: 0.01,
            booking: 0.025
          },
          throughput: {
            requestsPerMinute: 450,
            bookingsPerHour: 25
          },
          serviceHealth: {
            apiGateway: 'healthy',
            flights: 'healthy', 
            hotels: 'healthy',
            cars: 'healthy',
            concierge: 'healthy'
          }
        };
        
        res.json({ success: true, data });
      } catch (error) {
        console.error('Performance analytics error:', error);
        res.status(500).json({ success: false, error: { code: 'ANALYTICS_ERROR', message: 'Failed to load performance metrics' } });
      }
    });

    this.app.get('/admin/analytics/realtime', this.requireAdmin.bind(this), async (req, res) => {
      try {
        // Real-time metrics snapshot
        const now = new Date();
        const last5Min = new Date(now.getTime() - 5 * 60 * 1000);
        
        // These would come from real-time monitoring
        const data = {
          activeUsers: Math.floor(Math.random() * 1000) + 500,
          recentBookings: Math.floor(Math.random() * 50) + 10,
          totalRevenue: Math.floor(Math.random() * 50000) + 25000,
          dealsActive: Math.floor(Math.random() * 100) + 50,
          alerts: [
            {
              type: 'info',
              message: 'High booking volume detected',
              timestamp: now.toISOString()
            }
          ],
          lastUpdate: now.toISOString()
        };
        
        res.json({ success: true, data });
      } catch (error) {
        console.error('Real-time analytics error:', error);
        res.status(500).json({ success: false, error: { code: 'ANALYTICS_ERROR', message: 'Failed to load real-time data' } });
      }
    });

    // Track analytics events from client (clickstream)
    this.app.post('/analytics/track', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const traceId = (req as any).traceId;
        const payload = req.body || {};
        const now = new Date();
        const db = this.mongo.db(this.dbAnalyticsName);
        const collection = db.collection('clickstream');

        const doc = {
          eventId: payload.eventId || `evt_${now.getTime()}_${Math.random().toString(36).slice(2,8)}`,
          userId: payload.userId || null,
          sessionId: payload.sessionId || null,
          eventType: payload.name || payload.eventType || 'page_view',
          page: payload.url || payload.page || '',
          timestamp: payload.timestamp ? new Date(payload.timestamp) : now,
          userAgent: req.headers['user-agent'] || payload.userAgent || '',
          ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '',
          referrer: payload.referrer || null,
          searchQuery: payload.properties?.search || payload.searchQuery || null,
          filterCriteria: payload.properties?.filter || payload.filterCriteria || null,
          entityType: payload.properties?.entityType || null,
          entityId: payload.properties?.entityId || null,
          position: payload.properties?.position || null,
          metadata: payload.properties || null
        };

        await collection.insertOne(doc as any);

        // Best-effort publish to Kafka clickstream.events so downstream analytics
        // or streaming consumers can process this in real time.
        if (this.kafkaProducer) {
          try {
            await this.kafkaProducer.send({
              topic: 'clickstream.events',
              messages: [
                {
                  key: doc.userId || doc.sessionId || doc.eventId,
                  value: JSON.stringify(doc),
                },
              ],
            });
          } catch (kErr) {
            console.error('Kafka clickstream.events publish failed:', kErr);
          }
        }

        res.status(201).json({ success: true, data: { acknowledged: true }, traceId });
      } catch (error) {
        console.error('Analytics track error:', error);
        res.status(500).json({ success: false, error: { code: 'ANALYTICS_TRACK_ERROR', message: 'Failed to track event' } });
      }
    });

    // Existing endpoints...
    this.app.get('/admin/users', this.requireAdmin.bind(this), async (req, res) => {
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
      const offset = (page - 1) * limit;
      const [rows] = await this.db.query('SELECT id, email, first_name as firstName, last_name as lastName, created_at as createdAt FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
      res.json({ success: true, data: rows });
    });

    this.app.get('/admin/bookings', this.requireAdmin.bind(this), async (req, res) => {
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 20);
      const offset = (page - 1) * limit;
      const [rows] = await this.db.query('SELECT id, user_id as userId, type, status, total_amount as totalAmount, currency, confirmation_number as confirmationNumber, created_at as createdAt FROM bookings ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
      res.json({ success: true, data: rows });
    });

    // Stub: create listing
    this.app.post('/admin/listings', this.requireAdmin.bind(this), async (req, res) => {
      res.json({ success: true, data: { id: 'temp', ...req.body } });
    });

    // ========== FLIGHTS CRUD ==========
    this.app.post('/admin/flights', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { airline, flightNumber, originAirportCode, destinationAirportCode, departureTime, arrivalTime, 
          durationMinutes, aircraft, price, currency = 'USD', availableSeats, flightClass = 'economy', 
          bookingClass, refundable = false, changeable = false } = req.body;
        
        if (!airline || !flightNumber || !originAirportCode || !destinationAirportCode || !departureTime || !arrivalTime || !durationMinutes || !price || !availableSeats) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing required fields' } });
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        await this.db.query(
          `INSERT INTO flights (id, airline, flight_number, origin_airport_code, destination_airport_code, 
           departure_time, arrival_time, duration_minutes, aircraft, price, currency, available_seats, 
           class, booking_class, refundable, changeable) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, airline, flightNumber, originAirportCode, destinationAirportCode, departureTime, arrivalTime, 
           durationMinutes, aircraft || null, price, currency, availableSeats, flightClass, bookingClass || null, 
           refundable ? 1 : 0, changeable ? 1 : 0]
        );
        res.status(201).json({ success: true, data: { id } });
      } catch (error) {
        console.error('Create flight error:', error);
        res.status(500).json({ success: false, error: { code: 'CREATE_ERROR', message: 'Failed to create flight' } });
      }
    });

    this.app.put('/admin/flights/:id', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const updates: string[] = [];
        const values: any[] = [];
        
        const fields = ['airline', 'flightNumber', 'originAirportCode', 'destinationAirportCode', 'departureTime', 
          'arrivalTime', 'durationMinutes', 'aircraft', 'price', 'currency', 'availableSeats', 'flightClass', 
          'bookingClass', 'refundable', 'changeable'];
        const dbFields = ['airline', 'flight_number', 'origin_airport_code', 'destination_airport_code', 
          'departure_time', 'arrival_time', 'duration_minutes', 'aircraft', 'price', 'currency', 
          'available_seats', 'class', 'booking_class', 'refundable', 'changeable'];
        
        fields.forEach((field, i) => {
          if (req.body[field] !== undefined) {
            updates.push(`${dbFields[i]} = ?`);
            values.push(req.body[field]);
          }
        });

        if (updates.length === 0) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
        }

        values.push(id);
        const [result] = await this.db.query(`UPDATE flights SET ${updates.join(', ')} WHERE id = ?`, values);
        
        if ((result as any).affectedRows === 0) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Flight not found' } });
        }

        res.json({ success: true, data: { id, updated: true } });
      } catch (error) {
        console.error('Update flight error:', error);
        res.status(500).json({ success: false, error: { code: 'UPDATE_ERROR', message: 'Failed to update flight' } });
      }
    });

    this.app.delete('/admin/flights/:id', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const [result] = await this.db.query('DELETE FROM flights WHERE id = ?', [id]);
        
        if ((result as any).affectedRows === 0) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Flight not found' } });
        }

        res.json({ success: true, data: { id, deleted: true } });
      } catch (error) {
        console.error('Delete flight error:', error);
        res.status(500).json({ success: false, error: { code: 'DELETE_ERROR', message: 'Failed to delete flight' } });
      }
    });

    // ========== HOTELS CRUD ==========
    this.app.post('/admin/hotels', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { name, description, starRating, locationCode, addressStreet, addressCity, addressState, addressZipCode, 
                addressCountry, averagePrice, latitude, longitude, amenities, policies } = req.body;
        
        if (!name || !addressCity) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'name and addressCity are required' } });
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        await this.db.query(
          `INSERT INTO hotels (id, name, description, star_rating, location_code, address_street, address_city, 
           address_state, address_zip_code, address_country, average_price, latitude, longitude, amenities, policies) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, name, description || null, starRating || 3, locationCode || null, addressStreet || '', addressCity, 
           addressState || 'CA', addressZipCode || '', addressCountry || 'US', averagePrice || 100.00,
           latitude || null, longitude || null, amenities ? JSON.stringify(amenities) : null, 
           policies ? JSON.stringify(policies) : null]
        );
        res.status(201).json({ success: true, data: { id } });
      } catch (error) {
        console.error('Create hotel error:', error);
        res.status(500).json({ success: false, error: { code: 'CREATE_ERROR', message: 'Failed to create hotel' } });
      }
    });

    this.app.put('/admin/hotels/:id', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const updates: string[] = [];
        const values: any[] = [];
        
        const mapping: Record<string, string> = {
          name: 'name', description: 'description', starRating: 'star_rating', locationCode: 'location_code',
          addressStreet: 'address_street', addressCity: 'address_city', addressState: 'address_state',
          addressZipCode: 'address_zip_code', addressCountry: 'address_country', averagePrice: 'average_price',
          latitude: 'latitude', longitude: 'longitude'
        };
        
        Object.keys(mapping).forEach(key => {
          if (req.body[key] !== undefined) {
            updates.push(`${mapping[key]} = ?`);
            values.push(req.body[key]);
          }
        });

        if (req.body.amenities !== undefined) {
          updates.push('amenities = ?');
          values.push(JSON.stringify(req.body.amenities));
        }
        if (req.body.policies !== undefined) {
          updates.push('policies = ?');
          values.push(JSON.stringify(req.body.policies));
        }

        if (updates.length === 0) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
        }

        values.push(id);
        const [result] = await this.db.query(`UPDATE hotels SET ${updates.join(', ')} WHERE id = ?`, values);
        
        if ((result as any).affectedRows === 0) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Hotel not found' } });
        }

        res.json({ success: true, data: { id, updated: true } });
      } catch (error) {
        console.error('Update hotel error:', error);
        res.status(500).json({ success: false, error: { code: 'UPDATE_ERROR', message: 'Failed to update hotel' } });
      }
    });

    this.app.delete('/admin/hotels/:id', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const [result] = await this.db.query('DELETE FROM hotels WHERE id = ?', [id]);
        
        if ((result as any).affectedRows === 0) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Hotel not found' } });
        }

        res.json({ success: true, data: { id, deleted: true } });
      } catch (error) {
        console.error('Delete hotel error:', error);
        res.status(500).json({ success: false, error: { code: 'DELETE_ERROR', message: 'Failed to delete hotel' } });
      }
    });

    // ========== CARS CRUD ==========
    this.app.post('/admin/cars', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { vendor, locationCode, locationName, vehicleType, make, model, year, transmission = 'automatic', 
          fuelType = 'gasoline', seats, doors, dailyRate, currency = 'USD', available = true, features } = req.body;
        
        if (!vendor || !locationCode || !locationName || !vehicleType || !make || !model || !year || !seats || !doors || !dailyRate) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing required fields' } });
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        await this.db.query(
          `INSERT INTO car_rentals (id, vendor, location_code, location_name, vehicle_type, make, model, year, 
           transmission, fuel_type, seats, doors, daily_rate, currency, available, features) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, vendor, locationCode, locationName, vehicleType, make, model, year, transmission, fuelType, seats, doors, 
           dailyRate, currency, available ? 1 : 0, features ? JSON.stringify(features) : null]
        );
        res.status(201).json({ success: true, data: { id } });
      } catch (error) {
        console.error('Create car error:', error);
        res.status(500).json({ success: false, error: { code: 'CREATE_ERROR', message: 'Failed to create car' } });
      }
    });

    this.app.put('/admin/cars/:id', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const updates: string[] = [];
        const values: any[] = [];
        
        const mapping: Record<string, string> = {
          vendor: 'vendor', locationCode: 'location_code', locationName: 'location_name', 
          vehicleType: 'vehicle_type', make: 'make', model: 'model', year: 'year', 
          transmission: 'transmission', fuelType: 'fuel_type', seats: 'seats', doors: 'doors', 
          dailyRate: 'daily_rate', currency: 'currency', available: 'available'
        };
        
        Object.keys(mapping).forEach(key => {
          if (req.body[key] !== undefined) {
            updates.push(`${mapping[key]} = ?`);
            values.push(req.body[key]);
          }
        });

        if (req.body.features !== undefined) {
          updates.push('features = ?');
          values.push(JSON.stringify(req.body.features));
        }

        if (updates.length === 0) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No fields to update' } });
        }

        values.push(id);
        const [result] = await this.db.query(`UPDATE car_rentals SET ${updates.join(', ')} WHERE id = ?`, values);
        
        if ((result as any).affectedRows === 0) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Car not found' } });
        }

        res.json({ success: true, data: { id, updated: true } });
      } catch (error) {
        console.error('Update car error:', error);
        res.status(500).json({ success: false, error: { code: 'UPDATE_ERROR', message: 'Failed to update car' } });
      }
    });

    this.app.delete('/admin/cars/:id', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { id } = req.params;
        const [result] = await this.db.query('DELETE FROM car_rentals WHERE id = ?', [id]);
        
        if ((result as any).affectedRows === 0) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Car not found' } });
        }

        res.json({ success: true, data: { id, deleted: true } });
      } catch (error) {
        console.error('Delete car error:', error);
        res.status(500).json({ success: false, error: { code: 'DELETE_ERROR', message: 'Failed to delete car' } });
      }
    });

    // Reviews: create and list for flights/hotels/cars stored in MongoDB
    this.app.post('/admin/reviews', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { userId, entityType, entityId, rating, reviewText, title, pros, cons } = req.body || {};
        if (!userId || !entityType || !entityId || !rating || !reviewText) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'userId, entityType, entityId, rating, reviewText are required' } });
        }
        if (!['flight','hotel','car'].includes(String(entityType))) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'entityType must be one of flight|hotel|car' } });
        }
        const r = Number(rating);
        if (isNaN(r) || r < 1 || r > 5) {
          return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'rating must be 1-5' } });
        }
        const db = this.mongo.db(this.dbCoreName);
        const reviews = db.collection('reviews');
        const now = new Date();
        const doc = {
          reviewId: `rev_${now.getTime()}_${Math.random().toString(36).slice(2,8)}`,
          userId: String(userId),
          entityType: String(entityType),
          entityId: String(entityId),
          rating: r,
          reviewText: String(reviewText),
          title: title ? String(title) : undefined,
          pros: Array.isArray(pros) ? pros : null,
          cons: Array.isArray(cons) ? cons : null,
          createdAt: now,
          updatedAt: now,
          helpfulCount: 0,
          verified: false
        };
        await reviews.insertOne(doc as any);
        res.status(201).json({ success: true, data: { reviewId: doc.reviewId } });
      } catch (error) {
        console.error('Create review error:', error);
        res.status(500).json({ success: false, error: { code: 'REVIEW_CREATE_ERROR', message: 'Failed to create review' } });
      }
    });

    this.app.get('/admin/reviews', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { entityType, entityId, userId, page = '1', limit = '20' } = req.query as Record<string,string>;
        const p = Math.max(1, Number(page));
        const l = Math.max(1, Math.min(100, Number(limit)));
        const skip = (p - 1) * l;
        const db = this.mongo.db(this.dbCoreName);
        const reviews = db.collection('reviews');
        const filter: any = {};
        if (entityType) filter.entityType = entityType;
        if (entityId) filter.entityId = entityId;
        if (userId) filter.userId = userId;
        const cursor = reviews.find(filter).sort({ createdAt: -1 }).skip(skip).limit(l);
        const data = await cursor.toArray();
        res.json({ success: true, data: { results: data, page: p, limit: l } });
      } catch (error) {
        console.error('List reviews error:', error);
        res.status(500).json({ success: false, error: { code: 'REVIEW_LIST_ERROR', message: 'Failed to list reviews' } });
      }
    });

    // ========== BILLING REPORTS ==========
    this.app.get('/admin/billing/reports/revenue', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { startDate, endDate, groupBy = 'day' } = req.query;
        
        let dateFilter = '';
        const params: any[] = [];
        
        if (startDate) {
          dateFilter += ' AND p.created_at >= ?';
          params.push(startDate);
        }
        if (endDate) {
          dateFilter += ' AND p.created_at <= ?';
          params.push(endDate);
        }
        
        const groupByClause = groupBy === 'month' 
          ? "DATE_FORMAT(p.created_at, '%Y-%m')" 
          : "DATE(p.created_at)";
        
        const sql = `
          SELECT 
            ${groupByClause} as period,
            COUNT(DISTINCT p.id) as total_transactions,
            SUM(p.amount) as total_revenue,
            AVG(p.amount) as avg_transaction,
            COUNT(DISTINCT b.user_id) as unique_customers,
            SUM(CASE WHEN p.status = 'succeeded' THEN p.amount ELSE 0 END) as successful_revenue,
            SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed_transactions
          FROM payments p
          JOIN bookings b ON p.booking_id = b.id
          WHERE 1=1 ${dateFilter}
          GROUP BY period
          ORDER BY period DESC
        `;
        
        const [rows] = await this.db.execute(sql, params);
        res.json({ success: true, data: rows });
      } catch (error) {
        console.error('Billing revenue report error:', error);
        res.status(500).json({ success: false, error: { code: 'REPORT_ERROR', message: 'Failed to generate revenue report' } });
      }
    });

    this.app.get('/admin/billing/reports/payments', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const { status, startDate, endDate, page = '1', limit = '50' } = req.query;
        const p = Math.max(1, Number(page));
        const l = Math.max(1, Math.min(100, Number(limit)));
        const offset = (p - 1) * l;
        
        let whereClause = 'WHERE 1=1';
        const params: any[] = [];
        
        if (status) {
          whereClause += ' AND p.status = ?';
          params.push(status);
        }
        if (startDate) {
          whereClause += ' AND p.created_at >= ?';
          params.push(startDate);
        }
        if (endDate) {
          whereClause += ' AND p.created_at <= ?';
          params.push(endDate);
        }
        
        const sql = `
          SELECT 
            p.id,
            p.booking_id,
            p.amount,
            p.currency,
            p.status,
            p.payment_method,
            p.created_at,
            b.user_id,
            b.type as booking_type,
            b.confirmation_number
          FROM payments p
          JOIN bookings b ON p.booking_id = b.id
          ${whereClause}
          ORDER BY p.created_at DESC
          LIMIT ? OFFSET ?
        `;
        
        params.push(l, offset);
        const [rows] = await this.db.query(sql, params);
        
        // Get total count
        const countSql = `SELECT COUNT(*) as total FROM payments p JOIN bookings b ON p.booking_id = b.id ${whereClause}`;
        const [countRows] = await this.db.execute(countSql, params.slice(0, -2));
        const total = (countRows as any[])[0].total;
        
        res.json({ 
          success: true, 
          data: { 
            payments: rows, 
            page: p, 
            limit: l, 
            total,
            totalPages: Math.ceil(total / l)
          } 
        });
      } catch (error) {
        console.error('Billing payments report error:', error);
        res.status(500).json({ success: false, error: { code: 'REPORT_ERROR', message: 'Failed to generate payments report' } });
      }
    });

    this.app.get('/admin/billing/summary', this.requireAdmin.bind(this), async (req, res) => {
      try {
        const sql = `
          SELECT 
            COUNT(*) as total_payments,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as successful_payments,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_payments,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_payments,
            SUM(amount) as total_volume,
            SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END) as successful_volume,
            AVG(CASE WHEN status = 'succeeded' THEN amount ELSE NULL END) as avg_transaction_value
          FROM payments
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `;
        
        const [rows] = await this.db.execute(sql);
        res.json({ success: true, data: (rows as any[])[0] });
      } catch (error) {
        console.error('Billing summary error:', error);
        res.status(500).json({ success: false, error: { code: 'REPORT_ERROR', message: 'Failed to generate billing summary' } });
      }
    });
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Admin Service listening on ${this.port}`);
      console.log(`📊 Analytics endpoints ready at /admin/analytics/*`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down Admin Service...');
      await this.mongo.close();
      await this.db.end();
      process.exit(0);
    });
  }
}

const svc = new AdminService();
svc.start();
