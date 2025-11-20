/**
 * Flights Service - Search, filter, and book flights
 */

import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { FlightDealConsumer } from './services/kafkaConsumer';
import { 
  Flight, 
  FlightSearchRequest, 
  FlightSearchResponse,
  ApiResponse,
  generateTraceId 
} from '@kayak/shared';

export class FlightsService {
  public app: express.Application;
  private db!: mysql.Pool;
  private redis: any;
  private port: number = 8002;
  private dealConsumer!: FlightDealConsumer;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.initializeDatabases();
    this.setupRoutes();
    this.initializeKafkaConsumer();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use((req, res, next) => {
      const traceId = req.headers['x-trace-id'] as string || generateTraceId();
      (req as any).traceId = traceId;
      res.setHeader('X-Trace-Id', traceId);
      next();
    });
  }

  private async initializeDatabases() {
    try {
      this.db = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'kayak',
        password: process.env.DB_PASSWORD || 'change_me_db_password',
        database: process.env.DB_NAME || 'kayak',
        connectionLimit: 50
      });

      this.redis = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      await this.redis.connect();

      console.log('✅ All databases connected');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
    }
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'healthy',
          service: 'flights-svc',
          timestamp: new Date().toISOString()
        }
      });
    });

    // Search flights (support both GET query params and POST JSON body)
    this.app.get('/flights/search', this.searchFlights.bind(this));
    this.app.post('/flights/search', this.searchFlights.bind(this));
    
    // Get flight by ID
    this.app.get('/flights/:id', this.getFlightById.bind(this));
    
    // Get available flights for route
    this.app.get('/flights/route/:origin/:destination', this.getFlightsByRoute.bind(this));

    // --- Saga Endpoints ---
    // Create a flight reservation (Reserve step)
    this.app.post('/flights/:id/reservations', this.createReservation.bind(this));
    
    // Confirm a flight reservation (Confirm step)
    this.app.patch('/flights/reservations/:reservationId', this.confirmReservation.bind(this));

    // Cancel a flight reservation (Compensate step)
    this.app.delete('/flights/reservations/:reservationId', this.cancelReservation.bind(this));
  }

  private async createReservation(req: Request, res: Response) {
    const { id: flightId } = req.params;
    const { bookingId, seats = 1 } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'bookingId is required' } });
    }

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Lock the flight row and check for available seats
      const [rows] = await conn.execute('SELECT available_seats FROM flights WHERE id = ? FOR UPDATE', [flightId]);
      const flight = (rows as any)[0];

      if (!flight) {
        throw new Error('Flight not found');
      }
      if (flight.available_seats < seats) {
        throw new Error('Not enough available seats');
      }

      // 2. Decrement available seats
      await conn.execute('UPDATE flights SET available_seats = available_seats - ? WHERE id = ?', [seats, flightId]);

      // 3. Create a pending reservation with an expiration
      const reservationId = uuidv4();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute expiration
      await conn.execute(
        `INSERT INTO flight_reservations (id, flight_id, booking_id, seats, status, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
        [reservationId, flightId, bookingId, seats, expiresAt]
      );

      await conn.commit();
      
      console.log(`[SAGA] Reservation ${reservationId} created for flight ${flightId}`);
      res.status(201).json({ success: true, data: { reservationId } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to create reservation for flight ${flightId}:`, error.message);
      res.status(500).json({ success: false, error: { code: 'RESERVATION_FAILED', message: error.message } });
    } finally {
      conn.release();
    }
  }

  private async confirmReservation(req: Request, res: Response) {
    const { reservationId } = req.params;
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute('SELECT * FROM flight_reservations WHERE id = ? AND status = ? FOR UPDATE', [reservationId, 'pending']);
      const reservation = (rows as any)[0];

      if (!reservation) {
        throw new Error('Pending reservation not found or already processed');
      }

      await conn.execute('UPDATE flight_reservations SET status = ?, expires_at = NULL WHERE id = ?', ['confirmed', reservationId]);
      await conn.commit();

      console.log(`[SAGA] Reservation ${reservationId} confirmed`);
      res.status(200).json({ success: true, data: { status: 'confirmed' } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to confirm reservation ${reservationId}:`, error.message);
      res.status(500).json({ success: false, error: { code: 'CONFIRMATION_FAILED', message: error.message } });
    } finally {
      conn.release();
    }
  }

  private async cancelReservation(req: Request, res: Response) {
    const { reservationId } = req.params;
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Find the reservation
      const [rows] = await conn.execute('SELECT * FROM flight_reservations WHERE id = ? AND status = ? FOR UPDATE', [reservationId, 'pending']);
      const reservation = (rows as any)[0];

      if (!reservation) {
        // If not found, it might have been confirmed or already cancelled. This is not an error in a saga.
        console.log(`[SAGA] Compensation: Reservation ${reservationId} not found or not in pending state. Assuming already handled.`);
        await conn.commit();
        return res.status(200).json({ success: true, data: { message: 'Reservation already processed or not found' } });
      }

      // 2. Mark reservation as cancelled
      await conn.execute('UPDATE flight_reservations SET status = ? WHERE id = ?', ['cancelled', reservationId]);

      // 3. Increment available seats
      await conn.execute('UPDATE flights SET available_seats = available_seats + ? WHERE id = ?', [reservation.seats, reservation.flight_id]);

      await conn.commit();

      console.log(`[SAGA] Compensation: Reservation ${reservationId} cancelled, seats released.`);
      res.status(200).json({ success: true, data: { status: 'cancelled' } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to cancel reservation ${reservationId}:`, error.message);
      res.status(500).json({ success: false, error: { code: 'COMPENSATION_FAILED', message: error.message } });
    } finally {
      conn.release();
    }
  }


  private async searchFlights(req: Request, res: Response) {
    try {
      const source = req.method === 'GET' ? req.query : req.body;
      const searchParams: FlightSearchRequest = source as any;
      
      // Validate required fields
      if (!searchParams.origin || !searchParams.destination) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Origin and destination are required fields',
            traceId: (req as any).traceId
          }
        });
      }
      
      // Try cache first
      const cacheKey = `flights_search:${JSON.stringify(searchParams)}`;
      if (this.redis && (this.redis as any).isReady) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const cachedData = JSON.parse(cached);
          return res.json({
            success: true,
            data: cachedData,
            traceId: (req as any).traceId
          });
        }
      }

      // Build query
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (searchParams.origin) {
        whereClause += ' AND origin_airport_code = ?';
        params.push(searchParams.origin);
      }

      if (searchParams.destination) {
        whereClause += ' AND destination_airport_code = ?';
        params.push(searchParams.destination);
      }

      if (searchParams.departureDate) {
        whereClause += ' AND DATE(departure_time) = ?';
        params.push(searchParams.departureDate);
      }

      if (searchParams.maxPrice) {
        whereClause += ' AND price <= ?';
        params.push(searchParams.maxPrice);
      }

      if (searchParams.class) {
        whereClause += ' AND class = ?';
        params.push(searchParams.class);
      }

      // Handle directOnly parameter (could be string "true"/"false" or boolean)
      const isDirectOnly = String(searchParams.directOnly) === 'true';
      if (isDirectOnly) {
        whereClause += ' AND duration_minutes <= 300'; // Assuming direct flights under 5 hours
      }

      if (searchParams.airlines && searchParams.airlines.length > 0) {
        whereClause += ` AND airline IN (${searchParams.airlines.map(() => '?').join(',')})`;
        params.push(...searchParams.airlines);
      }

      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const offset = (page - 1) * limit;

      const sql = `
        SELECT * FROM flights 
        ${whereClause}
        ORDER BY departure_time ASC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [rows] = await this.db.execute(sql, params);
      const flights = rows as any[];

      // Generate search ID
      const searchId = uuidv4();

      // Build response with filters
      const response: FlightSearchResponse = {
        flights: flights.map(this.formatFlight),
        searchId,
        totalResults: flights.length,
        filters: {
          airlines: this.buildAirlineFilters(flights),
          priceRange: this.buildPriceRange(flights),
          duration: this.buildDurationRange(flights),
          stops: this.buildStopsFilter(flights)
        }
      };

      // Cache results
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.setEx(cacheKey, 300, JSON.stringify(response)); // 5 min cache
      }

      res.json({
        success: true,
        data: response,
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Flight search error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async getFlightById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      const [rows] = await this.db.execute('SELECT * FROM flights WHERE id = ?', [id]);
      const flight = (rows as any[])[0];

      if (!flight) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Flight not found'
          }
        });
      }

      res.json({
        success: true,
        data: this.formatFlight(flight),
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Get flight error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async getFlightsByRoute(req: Request, res: Response) {
    try {
      const { origin, destination } = req.params;
      const { date, maxPrice, class: flightClass } = req.query as any;

      let whereClause = 'WHERE origin_airport_code = ? AND destination_airport_code = ?';
      const params: any[] = [origin, destination];

      if (date) {
        whereClause += ' AND DATE(departure_time) = ?';
        params.push(date as string);
      }

      if (maxPrice) {
        whereClause += ' AND price <= ?';
        params.push(Number(maxPrice));
      }

      if (flightClass) {
        whereClause += ' AND class = ?';
        params.push(flightClass);
      }

      const sql = `
        SELECT * FROM flights 
        ${whereClause}
        ORDER BY departure_time ASC
        LIMIT 50
      `;

      const [rows] = await this.db.execute(sql, params);
      const flights = rows as any[];

      res.json({
        success: true,
        data: flights.map(this.formatFlight),
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Get flights by route error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private formatFlight(flight: any): Flight {
    return {
      id: flight.id,
      airline: flight.airline,
      flightNumber: flight.flight_number,
      origin: {
        code: flight.origin_airport_code,
        name: flight.origin_airport_code, // Would be enriched from airport data
        city: flight.origin_airport_code,
        country: 'US',
        timezone: 'UTC'
      },
      destination: {
        code: flight.destination_airport_code,
        name: flight.destination_airport_code,
        city: flight.destination_airport_code,
        country: 'US',
        timezone: 'UTC'
      },
      departureTime: flight.departure_time,
      arrivalTime: flight.arrival_time,
      duration: flight.duration_minutes,
      aircraft: flight.aircraft,
      price: flight.price,
      currency: flight.currency,
      availableSeats: flight.available_seats,
      class: flight.class,
      amenities: [], // Would be populated from additional data
      bookingClass: flight.booking_class,
      refundable: flight.refundable,
      changeable: flight.changeable,
      createdAt: flight.created_at,
      updatedAt: flight.updated_at
    };
  }

  private buildAirlineFilters(flights: any[]) {
    const airlines: { [key: string]: { code: string; name: string; count: number } } = {};
    flights.forEach(flight => {
      if (!airlines[flight.airline]) {
        airlines[flight.airline] = {
          code: flight.airline.substring(0, 2).toUpperCase(),
          name: flight.airline,
          count: 0
        };
      }
      airlines[flight.airline].count++;
    });
    return Object.values(airlines);
  }

  private buildPriceRange(flights: any[]) {
    if (flights.length === 0) return { min: 0, max: 0, avg: 0 };
    
    const prices = flights.map(f => f.price);
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    };
  }

  private buildDurationRange(flights: any[]) {
    if (flights.length === 0) return { min: 0, max: 0, avg: 0 };
    
    const durations = flights.map(f => f.duration_minutes);
    return {
      min: Math.min(...durations),
      max: Math.max(...durations),
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    };
  }

  private buildStopsFilter(flights: any[]) {
    // Simplified stops calculation
    const direct = flights.filter(f => f.duration_minutes <= 300).length;
    const oneStop = flights.filter(f => f.duration_minutes > 300 && f.duration_minutes <= 600).length;
    const multiStop = flights.filter(f => f.duration_minutes > 600).length;
    
    return { direct, oneStop, multiStop };
  }

  private initializeKafkaConsumer() {
    this.dealConsumer = new FlightDealConsumer(this.db, this.redis);
    this.dealConsumer.start().catch(console.error);
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Flights Service listening on port ${this.port}`);
      console.log(`📍 Health check: http://localhost:${this.port}/health`);
    });

    // Start cleanup job for expired reservations
    this.startReservationCleanupJob();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down Flights Service...');
      await this.dealConsumer.stop();
      process.exit(0);
    });
  }

  private startReservationCleanupJob() {
    setInterval(async () => {
      try {
        const conn = await this.db.getConnection();
        await conn.beginTransaction();

        // Find expired pending reservations
        const [expired] = await conn.execute(`
          SELECT id, flight_id, seats 
          FROM flight_reservations 
          WHERE status = 'pending' AND expires_at < NOW()
        `);

        for (const res of expired as any[]) {
          await conn.execute(
            'UPDATE flight_reservations SET status = ? WHERE id = ?',
            ['expired', res.id]
          );
          await conn.execute(
            'UPDATE flights SET available_seats = available_seats + ? WHERE id = ?',
            [res.seats, res.flight_id]
          );
        }

        await conn.commit();
        conn.release();

        if ((expired as any[]).length > 0) {
          console.log(`[CLEANUP] Expired ${(expired as any[]).length} flight reservations`);
        }
      } catch (error) {
        console.error('[CLEANUP] Reservation cleanup error:', error);
      }
    }, 60000); // Run every minute
  }
}

// Start the service only if executed directly
if (require.main === module) {
  const flightsService = new FlightsService();
  flightsService.start();
}
