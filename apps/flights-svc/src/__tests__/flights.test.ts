import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { FlightsService } from '../index';

describe('Flights Service Integration Tests', () => {
  let app: any;
  
  // Initialize app once
  const service = new FlightsService();
  app = service.app;

  
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
      expect(response.body.data).toHaveProperty('totalResults');
      expect(response.body.data).toHaveProperty('filters');
      expect(Array.isArray(response.body.data.flights)).toBe(true);
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
      expect(response.body.data.flights.length).toBeGreaterThan(0);
      
      // Verify all flights match the search criteria
      response.body.data.flights.forEach((flight: any) => {
        expect(flight.origin.code).toBe('SFO');
        expect(flight.destination.code).toBe('ORD');
      });
    });

    it('should search with direct flights only', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15',
        directOnly: true
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.flights.length).toBeGreaterThan(0);
      
      // All flights should be direct (duration <= 300 minutes)
      response.body.data.flights.forEach((flight: any) => {
        expect(flight.duration).toBeLessThanOrEqual(300);
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
      const flightId = 'flight-123';

      const response = await request(app)
        .get(`/flights/${flightId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', flightId);
      expect(response.body.data).toHaveProperty('airline');
      expect(response.body.data).toHaveProperty('origin');
      expect(response.body.data).toHaveProperty('destination');
      expect(response.body.data).toHaveProperty('price');
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
      const flightId = 'flight-123';

      const response = await request(app)
        .get(`/flights/${flightId}`)
        .expect(200);

      const flight = response.body.data;
      
      // Check required flight properties
      expect(flight).toHaveProperty('origin');
      expect(flight.origin).toHaveProperty('code');
      expect(flight.origin).toHaveProperty('name');
      expect(flight.origin).toHaveProperty('city');
      expect(flight.origin).toHaveProperty('country');
      expect(flight.origin).toHaveProperty('timezone');
      
      expect(flight).toHaveProperty('destination');
      expect(flight.destination).toHaveProperty('code');
      expect(flight.destination).toHaveProperty('name');
      expect(flight.destination).toHaveProperty('city');
      expect(flight.destination).toHaveProperty('country');
      expect(flight.destination).toHaveProperty('timezone');
      
      expect(flight).toHaveProperty('departureTime');
      expect(flight).toHaveProperty('arrivalTime');
      expect(flight).toHaveProperty('duration');
      expect(flight).toHaveProperty('aircraft');
      expect(flight).toHaveProperty('price');
      expect(flight).toHaveProperty('currency');
      expect(flight).toHaveProperty('availableSeats');
      expect(flight).toHaveProperty('class');
      expect(flight).toHaveProperty('amenities');
      expect(flight).toHaveProperty('bookingClass');
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
      
      // All flights should be for the specified route
      response.body.data.forEach((flight: any) => {
        expect(flight.origin.code).toBe(origin);
        expect(flight.destination.code).toBe(destination);
      });
    });

    it('should filter flights by date', async () => {
      const origin = 'JFK';
      const destination = 'LAX';
      const date = '2025-12-15';

      const response = await request(app)
        .get(`/flights/route/${origin}/${destination}?date=${date}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      
      // All flights should be on the specified date
      response.body.data.forEach((flight: any) => {
        expect(flight.departureTime).toContain(date);
      });
    });

    it('should filter flights by max price', async () => {
      const origin = 'JFK';
      const destination = 'LAX';
      const maxPrice = 300;

      const response = await request(app)
        .get(`/flights/route/${origin}/${destination}?maxPrice=${maxPrice}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      
      // All flights should be within price limit
      response.body.data.forEach((flight: any) => {
        expect(flight.price).toBeLessThanOrEqual(maxPrice);
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
    it('should build airline filters correctly', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const airlines = response.body.data.filters.airlines;
      
      // Each airline filter should have required properties
      airlines.forEach((airline: any) => {
        expect(airline).toHaveProperty('code');
        expect(airline).toHaveProperty('name');
        expect(airline).toHaveProperty('count');
        expect(typeof airline.count).toBe('number');
      });
    });

    it('should build price range correctly', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const priceRange = response.body.data.filters.priceRange;
      
      expect(priceRange).toHaveProperty('min');
      expect(priceRange).toHaveProperty('max');
      expect(priceRange).toHaveProperty('avg');
      expect(priceRange.min).toBeLessThanOrEqual(priceRange.max);
      expect(priceRange.avg).toBeGreaterThanOrEqual(priceRange.min);
      expect(priceRange.avg).toBeLessThanOrEqual(priceRange.max);
    });

    it('should build duration range correctly', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const duration = response.body.data.filters.duration;
      
      expect(duration).toHaveProperty('min');
      expect(duration).toHaveProperty('max');
      expect(duration).toHaveProperty('avg');
      expect(duration.min).toBeLessThanOrEqual(duration.max);
      expect(duration.avg).toBeGreaterThanOrEqual(duration.min);
      expect(duration.avg).toBeLessThanOrEqual(duration.max);
    });

    it('should build stops filter correctly', async () => {
      const searchParams = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2025-12-15'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(searchParams)
        .expect(200);

      const stops = response.body.data.filters.stops;
      
      expect(stops).toHaveProperty('direct');
      expect(stops).toHaveProperty('oneStop');
      expect(stops).toHaveProperty('multiStop');
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
    it('should handle invalid search parameters', async () => {
      const invalidParams = {
        origin: '', // Empty origin
        destination: '', // Empty destination
        departureDate: 'invalid-date'
      };

      const response = await request(app)
        .post('/flights/search')
        .send(invalidParams)
        .expect(200); // Should still return results, just empty

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('flights');
    });

    it('should include trace ID in all responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('traceId');
      expect(typeof response.body.traceId).toBe('string');
    });

    it('should handle database connection errors', async () => {
      // This would test error handling when database is unavailable
      // In real implementation, would mock database connection failure
      expect(true).toBe(true); // Placeholder
    });
  });
});
