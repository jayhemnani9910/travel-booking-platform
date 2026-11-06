import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mysql from 'mysql2/promise';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { BookingService } from '../index';

// Kafka is the messaging edge: capture the consumer handler so tests can deliver payment events
let mockEachMessage: ((payload: any) => Promise<void>) | undefined;
const mockKafkaSend = jest.fn<(record: any) => Promise<void>>();
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: () => ({ connect: async () => undefined, send: mockKafkaSend }),
    consumer: () => ({
      connect: async () => undefined,
      subscribe: async () => undefined,
      run: async ({ eachMessage }: any) => { mockEachMessage = eachMessage; }
    })
  }))
}));

// User IDs are SSNs (###-##-####). This suite owns the 403-00-xxxx range.
const USER_ID = '403-00-0001';
const ROLLBACK_USER = '403-00-0002';
const USER_WITHOUT_BOOKINGS = '403-00-0099';
const FIXTURE_BOOKING = 'bk-booking-1';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'kayak_test'
};

/**
 * Stand-in for flights-svc, hotels-svc, cars-svc and billing-svc, which booking-svc calls over HTTP.
 * It records every call so tests can check reservations, compensations and payments.
 */
type Call = { method: string; path: string; body: any };
const createDownstream = () => {
  const calls: Call[] = [];
  const state = { failBilling: false };
  let counter = 0;
  const stub = express();
  stub.use(express.json());
  stub.use((req, _res, next) => {
    calls.push({ method: req.method, path: req.path, body: req.body });
    next();
  });

  const prices: Record<string, any> = {
    '/flights/bk-flight-1': { price: '299.99', currency: 'USD', airline: 'Delta Airlines', flightNumber: 'DL123' },
    '/flights/bk-flight-full': { price: '199.00', currency: 'USD' },
    '/hotels/bk-room-1': { pricePerNight: 150, currency: 'USD', name: 'Grand Plaza' },
    '/cars/bk-car-1': { dailyRate: 45, currency: 'USD', vendor: 'Hertz' }
  };
  stub.get(['/flights/:id', '/hotels/:id', '/cars/:id'], (req, res) => {
    const data = prices[req.path];
    if (!data) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    res.json({ success: true, data });
  });
  stub.post(['/flights/:id/reservations', '/hotels/rooms/:id/reservations', '/cars/:id/reservations'], (req, res) => {
    if (req.params.id === 'bk-flight-full') {
      return res.status(500).json({ success: false, error: { message: 'Not enough available seats' } });
    }
    counter += 1;
    res.status(201).json({ success: true, data: { reservationId: `res-${req.params.id}-${counter}` } });
  });
  stub.patch(['/flights/reservations/:id', '/hotels/reservations/:id', '/cars/reservations/:id'], (_req, res) => {
    res.json({ success: true, data: { status: 'confirmed' } });
  });
  stub.delete(['/flights/reservations/:id', '/hotels/reservations/:id', '/cars/reservations/:id'], (_req, res) => {
    res.json({ success: true, data: { status: 'cancelled' } });
  });
  stub.post('/billing/create-payment-intent', (req, res) => {
    if (state.failBilling) {
      return res.status(400).json({ success: false, error: { code: 'PAYMENT_FAILED', message: 'Card declined' } });
    }
    counter += 1;
    res.status(201).json({
      success: true,
      data: { paymentId: `pay-${counter}`, clientSecret: `pi_${counter}_secret_x`, paymentIntentId: `pi_${counter}` }
    });
  });

  return { stub, calls, state };
};

describe('Booking Service Integration Tests', () => {
  let service: BookingService;
  let app: any;
  let db: mysql.Connection;
  let server: Server;
  const downstream = createDownstream();

  const callsTo = (method: string, prefix: string) =>
    downstream.calls.filter(c => c.method === method && c.path.startsWith(prefix));

  const cleanup = async () => {
    await db.execute("DELETE FROM users WHERE id LIKE '403-%'");
  };

  const bookingCount = async (userId: string) => {
    const [rows] = await db.execute('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?', [userId]);
    return Number((rows as any[])[0].n);
  };

  const flightItem = (extra: Record<string, any> = {}) => ({
    type: 'flight',
    referenceId: 'bk-flight-1',
    quantity: 1,
    ...extra
  });

  beforeAll(async () => {
    server = downstream.stub.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.FLIGHTS_SVC_URL = base;
    process.env.HOTELS_SVC_URL = base;
    process.env.CARS_SVC_URL = base;
    process.env.BILLING_SVC_URL = base;

    db = await mysql.createConnection(dbConfig);
    await cleanup();
    for (const id of [USER_ID, ROLLBACK_USER]) {
      await db.execute(
        "INSERT INTO users (id, email, first_name, last_name) VALUES (?, ?, 'Book', 'Er')",
        [id, `${id}@booking-svc.test`]
      );
    }
    await db.execute(
      `INSERT INTO bookings (id, user_id, type, status, total_amount, currency, confirmation_number, created_at)
       VALUES (?, ?, 'flight', 'confirmed', 299.99, 'USD', 'KAYAK-BKFIXTUR', '2020-01-01 00:00:00')`,
      [FIXTURE_BOOKING, USER_ID]
    );
    await db.execute(
      `INSERT INTO booking_items (id, booking_id, type, reference_id, quantity, unit_price, total_price, details)
       VALUES ('bk-item-1', ?, 'flight', 'bk-flight-1', 1, 299.99, 299.99, ?)`,
      [FIXTURE_BOOKING, JSON.stringify({ reservationId: 'res-fixture' })]
    );

    service = new BookingService();
    app = service.app;
  });

  afterAll(async () => {
    await cleanup();
    await db.end();
    await (service as any).db.end();
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    downstream.calls.length = 0;
    downstream.state.failBilling = false;
    mockKafkaSend.mockReset();
    mockKafkaSend.mockResolvedValue(undefined);
  });

  describe('POST /bookings', () => {
    it('should create a booking successfully', async () => {
      const bookingData = {
        userId: USER_ID,
        type: 'flight',
        items: [
          {
            type: 'flight',
            referenceId: 'bk-flight-1',
            quantity: 2,
            details: {
              flightNumber: 'DL123',
              route: 'JFK-LAX'
            }
          }
        ],
        currency: 'USD'
      };

      const response = await request(app)
        .post('/bookings')
        .send(bookingData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.confirmationNumber).toBe(`TEMP-${response.body.data.id.slice(0, 8)}`);
      expect(response.body.data).toHaveProperty('totalAmount', 599.98);
      expect(response.body.data).toHaveProperty('currency', 'USD');
      expect(response.body.data).toHaveProperty('status', 'awaiting_payment');
      expect(response.body.data).toHaveProperty('type', 'flight');
      expect(response.body.data.paymentId).toMatch(/^pay-/);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0]).toMatchObject({ referenceId: 'bk-flight-1', quantity: 2, unitPrice: 299.99, totalPrice: 599.98 });

      // Two seats reserved with flights-svc, then payment requested for the server-side total
      const reservations = callsTo('POST', '/flights/bk-flight-1/reservations');
      expect(reservations).toHaveLength(1);
      expect(reservations[0].body).toEqual({ bookingId: response.body.data.id, seats: 2 });
      const payments = callsTo('POST', '/billing/create-payment-intent');
      expect(payments).toHaveLength(1);
      expect(payments[0].body).toEqual({ amount: 599.98, currency: 'usd', bookingId: response.body.data.id, userId: USER_ID });
    });

    it('should price a multi-item booking from the services, not the client', async () => {
      const bookingData = {
        userId: USER_ID,
        items: [
          { type: 'flight', referenceId: 'bk-flight-1', quantity: 1, unitPrice: 1, totalPrice: 1 },
          { type: 'hotel', referenceId: 'bk-room-1', startDate: '2025-12-15', endDate: '2025-12-17', unitPrice: 1 }
        ],
        currency: 'USD',
        totalAmount: 2 // ignored
      };

      const response = await request(app)
        .post('/bookings')
        .send(bookingData)
        .expect(201);

      expect(response.body.success).toBe(true);
      // 299.99 for the flight + 2 nights at 150.00
      expect(response.body.data.totalAmount).toBe(599.99);
      expect(response.body.data.type).toBe('package');
      expect(callsTo('POST', '/hotels/rooms/bk-room-1/reservations')).toHaveLength(1);
    });

    it('should calculate the total when no prices are sent', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, type: 'package', items: [flightItem()], currency: 'USD' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalAmount).toBe(299.99);
      expect(response.body.data.type).toBe('package');
    });

    it('should add the price of extras', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, items: [flightItem({ extras: { seatSelection: 'premium', checkedBag: true } })] })
        .expect(201);

      // 299.99 + 75 premium seat + 30 checked bag
      expect(response.body.data.totalAmount).toBe(404.99);
    });

    it('should reject booking without required fields', async () => {
      const invalidData = {
        userId: USER_ID
        // Missing items
      };

      const response = await request(app)
        .post('/bookings')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.message).toContain('userId and items are required');
    });

    it('should reject booking with empty items array', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, type: 'flight', items: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should reject booking with invalid item type', async () => {
      const invalidData = {
        userId: USER_ID,
        type: 'flight',
        items: [
          {
            type: 'invalid-type',
            referenceId: 'item-123',
            quantity: 1,
            unitPrice: 100.00
          }
        ]
      };

      const response = await request(app)
        .post('/bookings')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(downstream.calls).toHaveLength(0);
    });

    it('should reject a userId that is not an SSN', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: 'user-123', type: 'flight', items: [flightItem()] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_USER_ID');
      expect(downstream.calls).toHaveLength(0);
    });

    it('should handle transaction rollback on error', async () => {
      const before = await bookingCount(ROLLBACK_USER);

      // The first item reserves, the second fails, so the first is compensated
      const response = await request(app)
        .post('/bookings')
        .send({
          userId: ROLLBACK_USER,
          items: [flightItem(), { type: 'flight', referenceId: 'bk-flight-full', quantity: 1 }]
        })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BOOKING_FAILED');
      expect(response.body.error.message).toContain('Not enough available seats');

      const reserved = callsTo('POST', '/flights/bk-flight-1/reservations');
      expect(reserved).toHaveLength(1);
      const compensated = callsTo('DELETE', '/flights/reservations/');
      expect(compensated).toHaveLength(1);
      expect(compensated[0].path).toMatch(/^\/flights\/reservations\/res-bk-flight-1-\d+$/);
      expect(callsTo('POST', '/billing/')).toHaveLength(0);
      expect(await bookingCount(ROLLBACK_USER)).toBe(before);
    });

    it('should fail and compensate when the item cannot be priced', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: ROLLBACK_USER, items: [{ type: 'car', referenceId: 'no-such-car' }] })
        .expect(500);

      expect(response.body.error.code).toBe('BOOKING_FAILED');
      expect(callsTo('POST', '/cars/')).toHaveLength(0);
    });

    it('should mark the booking failed and release reservations when payment fails', async () => {
      downstream.state.failBilling = true;

      const response = await request(app)
        .post('/bookings')
        .send({ userId: ROLLBACK_USER, items: [{ type: 'car', referenceId: 'bk-car-1', startDate: '2025-12-15', endDate: '2025-12-18' }] })
        .expect(500);

      expect(response.body.error.code).toBe('BOOKING_FAILED');
      expect(response.body.error.message).toContain('Card declined');
      expect(callsTo('DELETE', '/cars/reservations/')).toHaveLength(1);

      const [rows] = await db.execute(
        "SELECT status, total_amount FROM bookings WHERE user_id = ? AND type = 'car'",
        [ROLLBACK_USER]
      );
      expect((rows as any[]).map(r => r.status)).toEqual(['failed']);
      // 3 days at 45.00
      expect(Number((rows as any[])[0].total_amount)).toBe(135);
    });

    it('should return the stored response for a repeated idempotency key', async () => {
      const key = `bk-idem-${Date.now()}`;
      const body = { userId: USER_ID, items: [flightItem()] };

      const first = await request(app).post('/bookings').set('X-Idempotency-Key', key).send(body).expect(201);
      const second = await request(app).post('/bookings').set('X-Idempotency-Key', key).send(body).expect(200);

      expect(second.body.data.id).toBe(first.body.data.id);
      expect(callsTo('POST', '/flights/bk-flight-1/reservations')).toHaveLength(1);
      await db.execute('DELETE FROM idempotency_keys WHERE `key` = ?', [key]);
    });
  });

  describe('GET /bookings/:id', () => {
    it('should get booking by ID', async () => {
      const response = await request(app)
        .get(`/bookings/${FIXTURE_BOOKING}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', FIXTURE_BOOKING);
      expect(response.body.data).toHaveProperty('confirmation_number', 'KAYAK-BKFIXTUR');
      expect(response.body.data).toHaveProperty('status', 'confirmed');
      expect(response.body.data).toHaveProperty('total_amount', '299.99');
    });

    it('should return 404 for non-existent booking', async () => {
      const response = await request(app)
        .get('/bookings/non-existent-booking')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should include booking items in response', async () => {
      const response = await request(app)
        .get(`/bookings/${FIXTURE_BOOKING}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.items)).toBe(true);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0]).toMatchObject({ id: 'bk-item-1', reference_id: 'bk-flight-1' });
    });
  });

  describe('GET /bookings/user/:userId', () => {
    it('should get user bookings', async () => {
      const response = await request(app)
        .get(`/bookings/user/${USER_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data.map((b: any) => b.id)).toContain(FIXTURE_BOOKING);

      // All bookings should belong to the specified user
      response.body.data.forEach((booking: any) => {
        expect(booking.userId).toBe(USER_ID);
      });
    });

    it('should return empty array for user with no bookings', async () => {
      const response = await request(app)
        .get(`/bookings/user/${USER_WITHOUT_BOOKINGS}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(0);
    });

    it('should include booking items in user bookings', async () => {
      const response = await request(app)
        .get(`/bookings/user/${USER_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      response.body.data.forEach((booking: any) => {
        expect(booking).toHaveProperty('items');
        expect(Array.isArray(booking.items)).toBe(true);
        expect(booking.items.length).toBeGreaterThan(0);
      });
      const fixture = response.body.data.find((b: any) => b.id === FIXTURE_BOOKING);
      expect(fixture.items).toEqual([
        { id: 'bk-item-1', type: 'flight', referenceId: 'bk-flight-1', quantity: 1, unitPrice: 299.99, totalPrice: 299.99 }
      ]);
    });
  });

  describe('Booking Status Management', () => {
    it('should create booking awaiting payment', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, type: 'flight', items: [flightItem()] })
        .expect(201);

      expect(response.body.success).toBe(true);
      const [rows] = await db.execute('SELECT status FROM bookings WHERE id = ?', [response.body.data.id]);
      expect((rows as any[])[0].status).toBe('awaiting_payment');
    });

    it('should handle different booking types', async () => {
      const cases = [
        { type: 'flight', item: flightItem() },
        { type: 'hotel', item: { type: 'hotel', referenceId: 'bk-room-1' } },
        { type: 'car', item: { type: 'car', referenceId: 'bk-car-1' } },
        { type: 'package', item: flightItem() }
      ];

      for (const { type, item } of cases) {
        const response = await request(app)
          .post('/bookings')
          .send({ userId: USER_ID, type, items: [item] })
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.data.type).toBe(type);
        expect(response.body.data.confirmationNumber).toMatch(/^TEMP-[0-9a-f]{8}$/);
      }
    });

    it('should confirm the booking when payment succeeds', async () => {
      const created = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, items: [flightItem()] })
        .expect(201);
      const bookingId = created.body.data.id;

      expect(mockEachMessage).toBeDefined();
      await mockEachMessage!({
        topic: 'payment.events',
        partition: 0,
        message: { value: Buffer.from(JSON.stringify({ event_type: 'payment_succeeded', booking_id: bookingId })) }
      });

      const response = await request(app).get(`/bookings/${bookingId}`).expect(200);
      expect(response.body.data.status).toBe('confirmed');
      expect(response.body.data.confirmation_number).toBe(`KAYAK-${bookingId.slice(0, 8).toUpperCase()}`);
      expect(callsTo('PATCH', '/flights/reservations/')).toHaveLength(1);
      expect(mockKafkaSend).toHaveBeenCalledTimes(1);
      expect(mockKafkaSend.mock.calls[0][0].topic).toBe('booking-confirmation');
    });

    it('should cancel a booking and release its reservations', async () => {
      const created = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, items: [{ type: 'hotel', referenceId: 'bk-room-1' }] })
        .expect(201);
      const bookingId = created.body.data.id;

      const response = await request(app).put(`/bookings/${bookingId}/cancel`).expect(200);
      expect(response.body.data).toEqual({ id: bookingId, status: 'cancelled' });
      expect(callsTo('DELETE', '/hotels/reservations/')).toHaveLength(1);

      const again = await request(app).put(`/bookings/${bookingId}/cancel`).expect(409);
      expect(again.body.error.code).toBe('ALREADY_CANCELLED');

      await request(app).put('/bookings/non-existent-booking/cancel').expect(404);
    });
  });

  describe('Data Validation', () => {
    it('should validate item quantities', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, type: 'flight', items: [flightItem({ quantity: 0 })] })
        .expect(201);

      // A quantity below 1 counts as one passenger
      expect(response.body.data.items[0].quantity).toBe(1);
      expect(response.body.data.totalAmount).toBe(299.99);
    });

    it('should ignore client prices, including negative ones', async () => {
      const response = await request(app)
        .post('/bookings')
        .send({ userId: USER_ID, type: 'flight', items: [flightItem({ unitPrice: -100.00 })] })
        .expect(201);

      expect(response.body.data.items[0].unitPrice).toBe(299.99);
      expect(response.body.data.totalAmount).toBe(299.99);
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.data.service).toBe('booking-svc');
    });
  });

  describe('Error Handling', () => {
    it('should include trace ID in all responses', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(typeof response.headers['x-trace-id']).toBe('string');
      expect(response.headers['x-trace-id'].length).toBeGreaterThan(0);

      const traced = await request(app)
        .get(`/bookings/${FIXTURE_BOOKING}`)
        .set('X-Trace-Id', 'trace-booking')
        .expect(200);
      expect(traced.headers['x-trace-id']).toBe('trace-booking');
      expect(traced.body.traceId).toBe('trace-booking');
    });

    it('should handle database connection errors', async () => {
      const broken = new BookingService();
      await (broken as any).db.end();

      const byId = await request(broken.app).get(`/bookings/${FIXTURE_BOOKING}`).expect(500);
      expect(byId.body.success).toBe(false);
      expect(byId.body.error.code).toBe('INTERNAL_ERROR');

      const byUser = await request(broken.app).get(`/bookings/user/${USER_ID}`).expect(500);
      expect(byUser.body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
