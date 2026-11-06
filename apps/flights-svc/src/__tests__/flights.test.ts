import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { FlightsService } from '../index';

// Kafka is not under test here; the deal consumer has its own unit tests
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    consumer: () => ({
      connect: async () => undefined,
      subscribe: async () => undefined,
      run: async () => undefined,
      disconnect: async () => undefined
    })
  }))
}));

const FIXTURE_FLIGHTS = [
  // id, airline, number, origin, destination, departure, arrival, minutes, price, seats, class
  ['ft-jfk-lax-1', 'Delta Airlines', 'DL123', 'JFK', 'LAX', '2025-12-15 08:00:00', '2025-12-15 13:30:00', 330, 299.99, 150, 'economy'],
  ['ft-jfk-lax-2', 'United Airlines', 'UA456', 'JFK', 'LAX', '2025-12-15 14:00:00', '2025-12-15 19:00:00', 300, 349.99, 120, 'economy'],
  ['ft-jfk-lax-3', 'American Airlines', 'AA789', 'JFK', 'LAX', '2025-12-15 18:00:00', '2025-12-16 06:00:00', 720, 899.00, 20, 'business'],
  ['ft-jfk-lax-4', 'Delta Airlines', 'DL555', 'JFK', 'LAX', '2025-12-16 09:00:00', '2025-12-16 16:00:00', 420, 259.00, 80, 'economy'],
  ['ft-sfo-ord-1', 'American Airlines', 'AA100', 'SFO', 'ORD', '2025-12-20 07:00:00', '2025-12-20 11:10:00', 250, 199.00, 100, 'economy'],
  ['ft-sfo-ord-2', 'Delta', 'DL200', 'SFO', 'ORD', '2025-12-20 09:00:00', '2025-12-20 13:20:00', 260, 219.00, 100, 'economy'],
  ['ft-sfo-ord-3', 'United Airlines', 'UA300', 'SFO', 'ORD', '2025-12-20 12:00:00', '2025-12-20 16:00:00', 240, 189.00, 100, 'economy']
];

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'kayak_test'
};

describe('Flights Service Integration Tests', () => {
  let service: FlightsService;
  let app: any;
  let db: mysql.Connection;

  beforeAll(async () => {
    db = await mysql.createConnection(dbConfig);
    await db.execute("DELETE FROM flights WHERE id LIKE 'ft-%'");
    for (const f of FIXTURE_FLIGHTS) {
      await db.execute(
        `INSERT INTO flights (id, airline, flight_number, origin_airport_code, destination_airport_code,
                              departure_time, arrival_time, duration_minutes, aircraft, price, currency,
                              available_seats, class, booking_class, refundable, changeable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Boeing 737', ?, 'USD', ?, ?, 'Y', TRUE, FALSE)`,
        f
      );
    }

    // Drop cached searches from earlier runs so the cache test starts cold
    const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redis.connect();
    const keys = await redis.keys('flights_search:*');
    if (keys.length > 0) await redis.del(keys);
    await redis.quit();

    service = new FlightsService();
    app = service.app;
  });

  afterAll(async () => {
    await db.execute("DELETE FROM flights WHERE id LIKE 'ft-%'");
    await db.end();
    await (service as any).db.end();
    await (service as any).redis.quit();
  });

  const ids = (flights: any[]) => flights.map((f: any) => f.id).sort();

  describe('POST /flights/search', () => {
    it('should search flights successfully', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15',
        passengers: 2,
        class: 'economy',
        maxPrice: 500
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('flights');
      expect(response.body.data).toHaveProperty('searchId');
      expect(response.body.data).toHaveProperty('totalResults', 2);
      expect(response.body.data).toHaveProperty('filters');
      expect(Array.isArray(response.body.data.flights)).toBe(true);
      expect(ids(response.body.data.flights)).toEqual(['ft-jfk-lax-1', 'ft-jfk-lax-2']);
    });

    it('should return filtered results', async () => {
      const searchParams = {
        origin: 'SFO',
        destination: 'ORD',
        departureDate: '2025-12-20',
        airlines: ['American Airlines', 'Delta']
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(ids(response.body.data.flights)).toEqual(['ft-sfo-ord-1', 'ft-sfo-ord-2']);

      // Verify all flights match the search criteria
      response.body.data.flights.forEach((flight: any) => {
        expect(flight.origin.code).toBe('SFO');
        expect(flight.destination.code).toBe('ORD');
        expect(['American Airlines', 'Delta']).toContain(flight.airline);
      });
    });

    it('should search with direct flights only', async () => {
      // Direct means a duration of at most 360 minutes; the only flight that day takes 420
      const longOnly = await request(app)
        .post('/flights/search')
        .send({ origin: 'JFK', destination: 'LAX', departureDate: '2025-12-16', directOnly: true })
        .expect(200);

      expect(longOnly.body.success).toBe(true);
      expect(longOnly.body.data.flights).toHaveLength(0);

      const response = await request(app)
        .post('/flights/search')
        .send({ origin: 'JFK', destination: 'LAX', departureDate: '2025-12-15', directOnly: 'true' })
        .expect(200);

      expect(ids(response.body.data.flights)).toEqual(['ft-jfk-lax-1', 'ft-jfk-lax-2']);
      response.body.data.flights.forEach((flight: any) => {
        expect(flight.duration).toBeLessThanOrEqual(360);
      });
    });

    it('should handle empty search results', async () => {
      const searchParams = {
        origin: 'XXX', // Non-existent airport
        destination: 'YYY',
        departureDate: '2025-12-15'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalResults).toBe(0);
      expect(response.body.data.flights).toHaveLength(0);
    });

    it('should cache search results', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15'
      };

      // First search
      const response1 = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const searchId1 = response1.body.data.searchId;

      // Second search with same parameters (should be cached)
      const response2 = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      expect(response2.body.data.searchId).toBe(searchId1);
      expect(response2.body.data).toEqual(response1.body.data);
    });

    it('should include filters in response', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      expect(response.body.data.filters).toHaveProperty('airlines');
      expect(response.body.data.filters).toHaveProperty('priceRange');
      expect(response.body.data.filters).toHaveProperty('duration');
      expect(response.body.data.filters).toHaveProperty('stops');
    });
  });

  describe('GET /flights/:id', () => {
    it('should get flight by ID', async () => {
      const flightId = 'ft-jfk-lax-1';

      const response = await request(app)
        .get(`/flights/${flightId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', flightId);
      expect(response.body.data).toHaveProperty('airline', 'Delta Airlines');
      expect(response.body.data).toHaveProperty('origin');
      expect(response.body.data).toHaveProperty('destination');
      expect(Number(response.body.data.price)).toBe(299.99);
    });

    it('should return 404 for non-existent flight', async () => {
      const flightId = 'non-existent-flight';

      const response = await request(app)
        .get(`/flights/${flightId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return formatted flight data', async () => {
      const flightId = 'ft-jfk-lax-1';

      const response = await request(app)
        .get(`/flights/${flightId}`)
        .expect(200);

      const flight = response.body.data;

      // Check required flight properties
      expect(flight).toHaveProperty('origin');
      expect(flight.origin).toHaveProperty('code', 'JFK');
      expect(flight.origin).toHaveProperty('name');
      expect(flight.origin).toHaveProperty('city');
      expect(flight.origin).toHaveProperty('country');
      expect(flight.origin).toHaveProperty('timezone');

      expect(flight).toHaveProperty('destination');
      expect(flight.destination).toHaveProperty('code', 'LAX');
      expect(flight.destination).toHaveProperty('name');
      expect(flight.destination).toHaveProperty('city');
      expect(flight.destination).toHaveProperty('country');
      expect(flight.destination).toHaveProperty('timezone');

      expect(flight).toHaveProperty('departureTime');
      expect(flight).toHaveProperty('arrivalTime');
      expect(flight).toHaveProperty('duration', 330);
      expect(flight).toHaveProperty('aircraft', 'Boeing 737');
      expect(flight).toHaveProperty('price');
      expect(flight).toHaveProperty('currency', 'USD');
      expect(flight).toHaveProperty('availableSeats', 150);
      expect(flight).toHaveProperty('class', 'economy');
      expect(flight).toHaveProperty('amenities');
      expect(flight).toHaveProperty('bookingClass', 'Y');
      expect(flight).toHaveProperty('refundable');
      expect(flight).toHaveProperty('changeable');
    });
  });

  describe('GET /flights/route/:origin/:destination', () => {
    it('should get flights for specific route', async () => {
      const origin = 'JFK';
      const destination = 'LAX';

      const response = await request(app)
        .get(`/flights/route/${origin}/${destination}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(ids(response.body.data)).toEqual(['ft-jfk-lax-1', 'ft-jfk-lax-2', 'ft-jfk-lax-3', 'ft-jfk-lax-4']);

      // All flights should be for the specified route
      response.body.data.forEach((flight: any) => {
        expect(flight.origin.code).toBe(origin);
        expect(flight.destination.code).toBe(destination);
      });
    });

    it('should filter flights by date', async () => {
      const origin = 'JFK';
      const destination = 'LAX';
      const date = '2025-12-16';

      const response = await request(app)
        .get(`/flights/route/${origin}/${destination}?date=${date}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(ids(response.body.data)).toEqual(['ft-jfk-lax-4']);
    });

    it('should filter flights by max price', async () => {
      const origin = 'JFK';
      const destination = 'LAX';
      const maxPrice = 300;

      const response = await request(app)
        .get(`/flights/route/${origin}/${destination}?maxPrice=${maxPrice}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(ids(response.body.data)).toEqual(['ft-jfk-lax-1', 'ft-jfk-lax-4']);

      // All flights should be within price limit
      response.body.data.forEach((flight: any) => {
        expect(Number(flight.price)).toBeLessThanOrEqual(maxPrice);
      });
    });

    it('should filter flights by class', async () => {
      const origin = 'JFK';
      const destination = 'LAX';
      const flightClass = 'business';

      const response = await request(app)
        .get(`/flights/route/${origin}/${destination}?class=${flightClass}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(ids(response.body.data)).toEqual(['ft-jfk-lax-3']);

      // All flights should be of specified class
      response.body.data.forEach((flight: any) => {
        expect(flight.class).toBe(flightClass);
      });
    });

    it('should handle route with no flights', async () => {
      const origin = 'XXX';
      const destination = 'YYY';

      const response = await request(app)
        .get(`/flights/route/${origin}/${destination}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('Filter Generation', () => {
    const searchParams = {
      origin: 'JFK',
      destination: 'LAX',
      departureDate: '2025-12-15'
    };

    it('should build airline filters correctly', async () => {
      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const airlines = response.body.data.filters.airlines;

      expect(airlines).toHaveLength(3);
      // Each airline filter should have required properties
      airlines.forEach((airline: any) => {
        expect(airline).toHaveProperty('code');
        expect(airline).toHaveProperty('name');
        expect(airline).toHaveProperty('count', 1);
        expect(typeof airline.count).toBe('number');
      });
      expect(airlines.find((a: any) => a.name === 'Delta Airlines').code).toBe('DE');
    });

    it('should build price range correctly', async () => {
      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const priceRange = response.body.data.filters.priceRange;

      expect(priceRange).toEqual({ min: 299.99, max: 899, avg: 516 });
      expect(priceRange.min).toBeLessThanOrEqual(priceRange.max);
      expect(priceRange.avg).toBeGreaterThanOrEqual(priceRange.min);
      expect(priceRange.avg).toBeLessThanOrEqual(priceRange.max);
    });

    it('should build duration range correctly', async () => {
      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const duration = response.body.data.filters.duration;

      expect(duration).toEqual({ min: 300, max: 720, avg: 450 });
      expect(duration.min).toBeLessThanOrEqual(duration.max);
      expect(duration.avg).toBeGreaterThanOrEqual(duration.min);
      expect(duration.avg).toBeLessThanOrEqual(duration.max);
    });

    it('should build stops filter correctly', async () => {
      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const stops = response.body.data.filters.stops;

      // 300 minutes is direct, 330 is one stop, 720 is multi stop
      expect(stops).toEqual({ direct: 1, oneStop: 1, multiStop: 1 });
      expect(typeof stops.direct).toBe('number');
      expect(typeof stops.oneStop).toBe('number');
      expect(typeof stops.multiStop).toBe('number');
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.data.service).toBe('flights-svc');
    });
  });

  describe('Error Handling', () => {
    it('should reject searches without origin and destination', async () => {
      const invalidParams = {
        origin: '', // Empty origin
        destination: '', // Empty destination
        departureDate: 'invalid-date'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(invalidParams)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Origin and destination are required');
    });

    it('should include trace ID in all responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(typeof response.headers['x-trace-id']).toBe('string');
      expect(response.headers['x-trace-id'].length).toBeGreaterThan(0);

      const traced = await request(app)
        .get('/flights/ft-jfk-lax-1')
        .set('X-Trace-Id', 'trace-abc')
        .expect(200);

      expect(traced.headers['x-trace-id']).toBe('trace-abc');
      expect(traced.body.traceId).toBe('trace-abc');
    });

    it('should handle database connection errors', async () => {
      const broken = new FlightsService();
      await (broken as any).db.end();

      const response = await request(broken.app)
        .get('/flights/ft-jfk-lax-1')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(typeof response.body.error.traceId).toBe('string');

      const search = await request(broken.app)
        .post('/flights/search')
        .send({ origin: 'BOS', destination: 'MIA' })
        .expect(500);

      expect(search.body.error.code).toBe('INTERNAL_ERROR');

      const redis = (broken as any).redis;
      if (redis.isOpen) await redis.quit();
    });
  });
});
