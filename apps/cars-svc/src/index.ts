/**
 * Cars Service - Search and book car rentals
 */

import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { CarDealConsumer } from './services/kafkaConsumer';
import { CarSearchRequest, CarSearchResponse, ApiResponse } from '@kayak/shared';

export class CarsService {
  private app: express.Application;
  private db!: mysql.Pool;
  private redis: any;
  private port: number = 8004;
  private dealConsumer!: CarDealConsumer;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.initializeDatabases();
    this.setupRoutes();
    this.initializeKafkaConsumer();
  }

  private setupMiddleware() {
    this.app.use(express.json());
  }

  private async initializeDatabases() {
    try {
      this.db = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'kayak',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'kayak',
        connectionLimit: 50
      });

      this.redis = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      await this.redis.connect();
      console.log('✅ Cars Service databases connected');
    } catch (error) {
      console.error('❌ Cars Service database connection failed:', error);
    }
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'healthy',
          service: 'cars-svc',
          timestamp: new Date().toISOString()
        }
      });
    });

    // Search cars (support both GET query params and POST JSON body)
    this.app.get('/cars/search', this.searchCars.bind(this));
    this.app.post('/cars/search', this.searchCars.bind(this));
    
    // Get car by ID
    this.app.get('/cars/:id', this.getCarById.bind(this));

    // --- Saga Endpoints ---
    this.app.post('/cars/:id/reservations', this.createReservation.bind(this));
    this.app.patch('/cars/reservations/:reservationId', this.confirmReservation.bind(this));
    this.app.delete('/cars/reservations/:reservationId', this.cancelReservation.bind(this));
  }

  private async createReservation(req: Request, res: Response) {
    const { id: carId } = req.params;
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'bookingId is required' } });
    }

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute('SELECT available FROM car_rentals WHERE id = ? FOR UPDATE', [carId]);
      const car = (rows as any)[0];

      if (!car) throw new Error('Car not found');
      if (!car.available) throw new Error('Car is not available');

      await conn.execute('UPDATE car_rentals SET available = 0 WHERE id = ?', [carId]);

      const reservationId = uuidv4();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute expiration
      await conn.execute(
        `INSERT INTO car_reservations (id, car_id, booking_id, status, expires_at)
         VALUES (?, ?, ?, 'pending', ?)`,
        [reservationId, carId, bookingId, expiresAt]
      );

      await conn.commit();
      
      console.log(`[SAGA] Reservation ${reservationId} created for car ${carId}`);
      res.status(201).json({ success: true, data: { reservationId } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to create car reservation for car ${carId}:`, error.message);
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
      const [rows] = await conn.execute('SELECT * FROM car_reservations WHERE id = ? AND status = ? FOR UPDATE', [reservationId, 'pending']);
      const reservation = (rows as any)[0];

      if (!reservation) throw new Error('Pending reservation not found or already processed');

      await conn.execute('UPDATE car_reservations SET status = ?, expires_at = NULL WHERE id = ?', ['confirmed', reservationId]);
      await conn.commit();

      console.log(`[SAGA] Car reservation ${reservationId} confirmed`);
      res.status(200).json({ success: true, data: { status: 'confirmed' } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to confirm car reservation ${reservationId}:`, error.message);
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

      const [rows] = await conn.execute('SELECT * FROM car_reservations WHERE id = ? AND status = ? FOR UPDATE', [reservationId, 'pending']);
      const reservation = (rows as any)[0];

      if (!reservation) {
        console.log(`[SAGA] Compensation: Car reservation ${reservationId} not found or not pending. Assuming handled.`);
        await conn.commit();
        return res.status(200).json({ success: true, data: { message: 'Reservation already processed or not found' } });
      }

      await conn.execute('UPDATE car_reservations SET status = ? WHERE id = ?', ['cancelled', reservationId]);
      await conn.execute('UPDATE car_rentals SET available = 1 WHERE id = ?', [reservation.car_id]);

      await conn.commit();

      console.log(`[SAGA] Compensation: Car reservation ${reservationId} cancelled, car released.`);
      res.status(200).json({ success: true, data: { status: 'cancelled' } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to cancel car reservation ${reservationId}:`, error.message);
      res.status(500).json({ success: false, error: { code: 'COMPENSATION_FAILED', message: error.message } });
    } finally {
      conn.release();
    }
  }

  private async searchCars(req: Request, res: Response) {
    try {
      // Support both GET (query) and POST (body) search contracts
      const source = req.method === 'GET' ? req.query : req.body;
      const searchParams: CarSearchRequest = source as any;
      const pickupLocation = (searchParams as any).pickupLocation || (searchParams as any).location;
      
      // Validate required fields
      if (!pickupLocation) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Pickup location is a required field',
            traceId: (req as any).traceId
          }
        });
      }

      // Normalize back into searchParams so the rest of the logic can use it
      (searchParams as any).pickupLocation = pickupLocation;
      
      const page = Math.max(Math.floor(Number(req.query.page)) || 1, 1);
      const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 20, 1), 100);
      const offset = (page - 1) * limit;

      // page/limit come from the query string, even for POST
      const cacheKey = `cars_search:${JSON.stringify(searchParams)}:${page}:${limit}`;
      if (this.redis && (this.redis as any).isReady) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached) });
        }
      }

      let whereClause = 'WHERE available = 1';
      const params: any[] = [];

      if (searchParams.pickupLocation) {
        whereClause += ' AND location_code LIKE ?';
        params.push(`%${searchParams.pickupLocation}%`);
      }

      if (searchParams.maxPrice) {
        whereClause += ' AND daily_rate <= ?';
        params.push(searchParams.maxPrice);
      }

      if (searchParams.transmission) {
        whereClause += ' AND transmission = ?';
        params.push(searchParams.transmission);
      }

      // A single GET ?carType=X arrives as a string, not an array
      const carType = ([] as string[]).concat(searchParams.carType ?? []);
      if (carType.length > 0) {
        whereClause += ` AND vehicle_type IN (${carType.map(() => '?').join(',')})`;
        params.push(...carType);
      }

      const sql = `
        SELECT * FROM car_rentals
        ${whereClause}
        ORDER BY daily_rate ASC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [rows] = await this.db.execute(sql, params);
      const cars = rows as any[];

      const searchId = uuidv4();
      const response: CarSearchResponse = {
        cars: cars.map(this.formatCar),
        searchId,
        totalResults: cars.length,
        filters: {
          priceRange: this.buildPriceRange(cars),
          carTypes: this.buildCarTypeFilters(cars),
          vendors: this.buildVendorFilters(cars),
          transmission: this.buildTransmissionFilters(cars)
        }
      };

      if (this.redis && (this.redis as any).isReady) {
        await this.redis.setEx(cacheKey, 300, JSON.stringify(response));
      }

      res.json({
        success: true,
        data: response
      });
    } catch (error: any) {
      console.error('Car search error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message
        }
      });
    }
  }

  private async getCarById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      const [rows] = await this.db.execute('SELECT * FROM car_rentals WHERE id = ?', [id]);
      const car = (rows as any[])[0];

      if (!car) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Car not found'
          }
        });
      }

      res.json({
        success: true,
        data: this.formatCar(car)
      });
    } catch (error: any) {
      console.error('Get car error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message
        }
      });
    }
  }

  private formatCar(car: any) {
    return {
      id: car.id,
      vendor: car.vendor,
      location: {
        code: car.location_code,
        name: car.location_code,
        address: car.location_code,
        city: car.location_code,
        state: 'CA', // Would be parsed from location
        country: 'US',
        coordinates: {
          lat: 0,
          lng: 0
        }
      },
      vehicleType: car.vehicle_type,
      make: car.make,
      model: car.model,
      year: car.year,
      transmission: car.transmission,
      fuelType: car.fuel_type,
      seats: car.seats,
      doors: car.doors,
      airConditioning: car.air_conditioning,
      dailyRate: car.daily_rate,
      currency: car.currency,
      available: car.available,
      images: car.images ? (Array.isArray(car.images) ? car.images : JSON.parse(car.images)) : [],
      policies: {
        minimumAge: car.minimum_age,
        mileagePolicy: car.mileage_policy,
        fuelPolicy: car.fuel_policy,
        insurance: car.insurance
      }
    };
  }

  private buildPriceRange(cars: any[]) {
    if (cars.length === 0) return { min: 0, max: 0, avg: 0 };
    const rates = cars.map(c => c.daily_rate);
    return {
      min: Math.min(...rates),
      max: Math.max(...rates),
      avg: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
    };
  }

  private buildCarTypeFilters(cars: any[]) {
    const types: { [key: string]: number } = {};
    cars.forEach(car => {
      types[car.vehicle_type] = (types[car.vehicle_type] || 0) + 1;
    });
    return Object.entries(types).map(([type, count]) => ({ type, count }));
  }

  private buildVendorFilters(cars: any[]) {
    const vendors: { [key: string]: number } = {};
    cars.forEach(car => {
      vendors[car.vendor] = (vendors[car.vendor] || 0) + 1;
    });
    return Object.entries(vendors).map(([name, count]) => ({ name, count }));
  }

  private buildTransmissionFilters(cars: any[]) {
    const transmissions: { [key: string]: number } = {};
    cars.forEach(car => {
      const trans = car.transmission as 'automatic' | 'manual';
      transmissions[trans] = (transmissions[trans] || 0) + 1;
    });
    return Object.entries(transmissions).map(([type, count]) => ({ 
      type: type as 'automatic' | 'manual', 
      count 
    }));
  }

  private initializeKafkaConsumer() {
    this.dealConsumer = new CarDealConsumer(this.db, this.redis);
    this.dealConsumer.start().catch(console.error);
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Cars Service listening on port ${this.port}`);
    });

    // Start cleanup job for expired reservations
    this.startReservationCleanupJob();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down Cars Service...');
      await this.dealConsumer.stop();
      process.exit(0);
    });
  }

  private startReservationCleanupJob() {
    setInterval(async () => {
      let conn: mysql.PoolConnection | undefined;
      try {
        conn = await this.db.getConnection();
        await conn.beginTransaction();

        const [expired] = await conn.execute(`
          SELECT id, car_id 
          FROM car_reservations 
          WHERE status = 'pending' AND expires_at < NOW()
        `);

        for (const res of expired as any[]) {
          // Re-check status so a concurrent confirm/cancel (or another replica) cannot release twice
          const [result] = await conn.execute(
            "UPDATE car_reservations SET status = ? WHERE id = ? AND status = 'pending'",
            ['expired', res.id]
          );
          if ((result as any).affectedRows !== 1) continue;
          await conn.execute(
            'UPDATE car_rentals SET available = 1 WHERE id = ?',
            [res.car_id]
          );
        }

        await conn.commit();

        if ((expired as any[]).length > 0) {
          console.log(`[CLEANUP] Expired ${(expired as any[]).length} car reservations`);
        }
      } catch (error) {
        if (conn) await conn.rollback().catch(() => {});
        console.error('[CLEANUP] Reservation cleanup error:', error);
      } finally {
        conn?.release();
      }
    }, 60000);
  }
}

// Start the service
if (require.main === module) {
  const carsService = new CarsService();
  carsService.start();
}
