/**
 * Hotels Service - Search and book hotels
 */

import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { HotelDealConsumer } from './services/kafkaConsumer';
import { HotelSearchRequest, HotelSearchResponse, ApiResponse } from '@kayak/shared';

export class HotelsService {
  private app: express.Application;
  private db!: mysql.Pool;
  private redis: any;
  private port: number = 8003;
  private dealConsumer!: HotelDealConsumer;

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
        password: process.env.DB_PASSWORD || 'change_me_db_password',
        database: process.env.DB_NAME || 'kayak',
        connectionLimit: 50
      });

      this.redis = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      await this.redis.connect();
      console.log('✅ Hotels Service databases connected');
    } catch (error) {
      console.error('❌ Hotels Service database connection failed:', error);
    }
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'healthy',
          service: 'hotels-svc',
          timestamp: new Date().toISOString()
        }
      });
    });

    // Search hotels (support both GET query params and POST JSON body)
    this.app.get('/hotels/search', this.searchHotels.bind(this));
    this.app.post('/hotels/search', this.searchHotels.bind(this));

    // Get hotel by ID
    this.app.get('/hotels/:id', this.getHotelById.bind(this));

    // --- Saga Endpoints ---
    this.app.post('/hotels/rooms/:id/reservations', this.createReservation.bind(this));
    this.app.patch('/hotels/reservations/:reservationId', this.confirmReservation.bind(this));
    this.app.delete('/hotels/reservations/:reservationId', this.cancelReservation.bind(this));
  }

  private async createReservation(req: Request, res: Response) {
    const { id: roomId } = req.params;
    const { bookingId, rooms = 1 } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'bookingId is required' } });
    }
    if (!Number.isInteger(rooms) || rooms < 1) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'rooms must be a positive integer' } });
    }

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute('SELECT available_rooms FROM hotel_rooms WHERE id = ? FOR UPDATE', [roomId]);
      const room = (rows as any)[0];

      if (!room) throw new Error('Hotel room not found');
      if (room.available_rooms < rooms) throw new Error(`Only ${room.available_rooms} room(s) available`);

      await conn.execute('UPDATE hotel_rooms SET available_rooms = available_rooms - ? WHERE id = ?', [rooms, roomId]);

      const reservationId = uuidv4();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute expiration
      await conn.execute(
        `INSERT INTO hotel_reservations (id, room_id, booking_id, status, expires_at)
         VALUES (?, ?, ?, 'pending', ?)`,
        [reservationId, roomId, bookingId, expiresAt]
      );

      await conn.commit();

      console.log(`[SAGA] Reservation ${reservationId} created for room ${roomId}`);
      res.status(201).json({ success: true, data: { reservationId } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to create hotel reservation for room ${roomId}:`, error.message);
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
      const [rows] = await conn.execute('SELECT * FROM hotel_reservations WHERE id = ? AND status = ? FOR UPDATE', [reservationId, 'pending']);
      const reservation = (rows as any)[0];

      if (!reservation) throw new Error('Pending reservation not found or already processed');

      await conn.execute('UPDATE hotel_reservations SET status = ?, expires_at = NULL WHERE id = ?', ['confirmed', reservationId]);
      await conn.commit();

      console.log(`[SAGA] Hotel reservation ${reservationId} confirmed`);
      res.status(200).json({ success: true, data: { status: 'confirmed' } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to confirm hotel reservation ${reservationId}:`, error.message);
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

      const [rows] = await conn.execute('SELECT * FROM hotel_reservations WHERE id = ? AND status = ? FOR UPDATE', [reservationId, 'pending']);
      const reservation = (rows as any)[0];

      if (!reservation) {
        console.log(`[SAGA] Compensation: Hotel reservation ${reservationId} not found or not pending. Assuming handled.`);
        await conn.commit();
        return res.status(200).json({ success: true, data: { message: 'Reservation already processed or not found' } });
      }

      await conn.execute('UPDATE hotel_reservations SET status = ? WHERE id = ?', ['cancelled', reservationId]);
      // Note: Currently assumes 1 room per reservation since hotel_reservations table doesn't track room count
      // If multiple rooms per reservation is needed, add a 'rooms' column to hotel_reservations
      await conn.execute('UPDATE hotel_rooms SET available_rooms = available_rooms + 1 WHERE id = ?', [reservation.room_id]);

      await conn.commit();

      console.log(`[SAGA] Compensation: Hotel reservation ${reservationId} cancelled, room released.`);
      res.status(200).json({ success: true, data: { status: 'cancelled' } });

    } catch (error: any) {
      await conn.rollback();
      console.error(`[SAGA] Failed to cancel hotel reservation ${reservationId}:`, error.message);
      res.status(500).json({ success: false, error: { code: 'COMPENSATION_FAILED', message: error.message } });
    } finally {
      conn.release();
    }
  }

  private async searchHotels(req: Request, res: Response) {
    try {
      const source = req.method === 'GET' ? req.query : req.body;
      const searchParams: HotelSearchRequest = source as any;
      const destination = (searchParams as any).destination || (searchParams as any).location;
      const minStarRatingRaw = (searchParams as any).minStarRating;

      if (destination) {
        (searchParams as any).destination = destination;
      }

      // If client sends a single minStarRating instead of starRating[],
      // expand it into a list [min..5].
      if (!searchParams.starRating && minStarRatingRaw !== undefined) {
        const minStar = Number(minStarRatingRaw);
        if (!Number.isNaN(minStar) && minStar >= 1 && minStar <= 5) {
          (searchParams as any).starRating = Array.from({ length: 5 - minStar + 1 }, (_, i) => minStar + i);
        }
      }

      // Validate required fields
      if (!searchParams.destination) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Destination is a required field',
            traceId: (req as any).traceId
          }
        });
      }

      const page = Math.max(Math.floor(Number(req.query.page)) || 1, 1);
      const limit = Math.min(Math.max(Math.floor(Number(req.query.limit)) || 20, 1), 100);
      const offset = (page - 1) * limit;

      // page/limit come from the query string, even for POST
      const cacheKey = `hotels_search:${JSON.stringify(searchParams)}:${page}:${limit}`;
      if (this.redis && (this.redis as any).isReady) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          res.setHeader('X-Cache', 'HIT');
          return res.json({
            success: true,
            data: JSON.parse(cached)
          });
        }
      }

      let whereClause = 'WHERE hr.available = 1 AND hr.available_rooms > 0';
      const params: any[] = [];

      if (searchParams.destination) {
        whereClause += ' AND (h.name LIKE ? OR CONCAT(h.address_city, ", ", h.address_state) LIKE ? OR h.location_code LIKE ?)';
        params.push(`%${searchParams.destination}%`, `%${searchParams.destination}%`, `%${searchParams.destination}%`);
      }



      if (searchParams.minPrice) {
        whereClause += ' AND hr.price_per_night >= ?';
        params.push(searchParams.minPrice);
      }

      if (searchParams.maxPrice) {
        whereClause += ' AND hr.price_per_night <= ?';
        params.push(searchParams.maxPrice);
      }

      // A single GET ?starRating=X arrives as a string, not an array
      const starRating = ([] as any[]).concat(searchParams.starRating ?? []);
      if (starRating.length > 0) {
        whereClause += ` AND h.star_rating IN (${starRating.map(() => '?').join(',')})`;
        params.push(...starRating);
      }

      const sql = `
         SELECT hr.id, hr.hotel_id, hr.type AS room_type, hr.description, hr.max_occupancy,
                hr.beds AS bed_type, hr.amenities, hr.price_per_night AS base_price,
                hr.currency, hr.available, hr.images,
                h.name, h.description AS hotel_description, h.star_rating,
                CONCAT(h.address_city, ', ', h.address_state) AS address
        FROM hotel_rooms hr
        JOIN hotels h ON hr.hotel_id = h.id
        ${whereClause}
        ORDER BY h.star_rating DESC, hr.price_per_night ASC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [rows] = await this.db.execute(sql, params);
      const hotels = rows as any[];

      const searchId = uuidv4();
      const response: HotelSearchResponse = {
        hotels: hotels.map(this.formatHotelRoom),
        searchId,
        totalResults: hotels.length,
        filters: {
          priceRange: this.buildPriceRange(hotels),
          starRatings: this.buildStarRatingFilters(hotels),
          amenities: this.buildAmenityFilters(hotels)
        }
      };

      if (this.redis && (this.redis as any).isReady) {
        await this.redis.setEx(cacheKey, 300, JSON.stringify(response));
      }

      res.setHeader('X-Cache', 'MISS');
      res.json({
        success: true,
        data: response
      });
    } catch (error: any) {
      console.error('Hotel search error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message
        }
      });
    }
  }

  private async getHotelById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Same aliases as searchHotels so formatHotelRoom gets the fields it reads
      const [rows] = await this.db.execute(`
        SELECT hr.id, hr.hotel_id, hr.type AS room_type, hr.description, hr.max_occupancy,
               hr.beds AS bed_type, hr.amenities, hr.price_per_night AS base_price,
               hr.currency, hr.available, hr.images,
               h.name, h.description AS hotel_description, h.star_rating,
               CONCAT(h.address_city, ', ', h.address_state) AS address
        FROM hotel_rooms hr
        JOIN hotels h ON hr.hotel_id = h.id
        WHERE hr.id = ?
      `, [id]);

      const hotel = (rows as any[])[0];

      if (!hotel) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Hotel not found'
          }
        });
      }

      res.json({
        success: true,
        data: this.formatHotelRoom(hotel)
      });
    } catch (error: any) {
      console.error('Get hotel error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message
        }
      });
    }
  }

  private formatHotelRoom(hotel: any) {
    return {
      id: hotel.id,
      hotelId: hotel.hotel_id,
      type: hotel.room_type,
      description: hotel.description,
      maxOccupancy: hotel.max_occupancy,
      beds: hotel.bed_type,
      amenities: hotel.amenities ? (Array.isArray(hotel.amenities) ? hotel.amenities : JSON.parse(hotel.amenities)) : [],
      images: hotel.images ? (Array.isArray(hotel.images) ? hotel.images : JSON.parse(hotel.images)) : [],
      pricePerNight: hotel.base_price,
      currency: hotel.currency,
      available: hotel.available === 1 || hotel.available === true,
      hotelName: hotel.name,
      starRating: hotel.star_rating,
      city: hotel.address
    };
  }

  private buildPriceRange(hotels: any[]) {
    if (hotels.length === 0) return { min: 0, max: 0, avg: 0 };
    const prices = hotels.map(h => h.base_price ?? 0);
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    };
  }

  private buildStarRatingFilters(hotels: any[]) {
    const ratings: { [key: number]: number } = {};
    hotels.forEach(hotel => {
      ratings[hotel.star_rating] = (ratings[hotel.star_rating] || 0) + 1;
    });
    return Object.entries(ratings).map(([rating, count]) => ({
      rating: parseInt(rating),
      count
    }));
  }

  private buildAmenityFilters(hotels: any[]) {
    const amenities: { [key: string]: number } = {};
    hotels.forEach(hotel => {
      if (hotel.amenities) {
        const amenityList = Array.isArray(hotel.amenities) ? hotel.amenities : JSON.parse(hotel.amenities);
        amenityList.forEach((amenity: string) => {
          amenities[amenity] = (amenities[amenity] || 0) + 1;
        });
      }
    });
    return Object.entries(amenities).map(([name, count]) => ({ name, count }));
  }

  private initializeKafkaConsumer() {
    this.dealConsumer = new HotelDealConsumer(this.db, this.redis);
    this.dealConsumer.start().catch(console.error);
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Hotels Service listening on port ${this.port}`);
    });

    // Start cleanup job for expired reservations
    this.startReservationCleanupJob();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('🛑 Shutting down Hotels Service...');
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
          SELECT id, room_id 
          FROM hotel_reservations 
          WHERE status = 'pending' AND expires_at < NOW()
        `);

        for (const res of expired as any[]) {
          // Re-check status so a concurrent confirm/cancel (or another replica) cannot release twice
          const [result] = await conn.execute(
            "UPDATE hotel_reservations SET status = ? WHERE id = ? AND status = 'pending'",
            ['expired', res.id]
          );
          if ((result as any).affectedRows !== 1) continue;
          await conn.execute(
            'UPDATE hotel_rooms SET available_rooms = available_rooms + 1 WHERE id = ?',
            [res.room_id]
          );
        }

        await conn.commit();

        if ((expired as any[]).length > 0) {
          console.log(`[CLEANUP] Expired ${(expired as any[]).length} hotel reservations`);
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
  const hotelsService = new HotelsService();
  hotelsService.start();
}
