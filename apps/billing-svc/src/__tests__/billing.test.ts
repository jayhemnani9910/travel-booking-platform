import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import mysql from 'mysql2/promise';
import { BillingService } from '../index';

// Stripe's API is the network edge: payment intents and refunds are mocked,
// webhook signatures use the real Stripe library so bad signatures really fail.
const mockStripe = {
  paymentIntents: {
    create: jest.fn<(params: any) => Promise<any>>(),
    retrieve: jest.fn<(id: string) => Promise<any>>()
  },
  refunds: {
    create: jest.fn<(params: any) => Promise<any>>()
  }
};

jest.mock('stripe', () => {
  const ActualStripe = jest.requireActual<any>('stripe');
  const webhooks = new ActualStripe('sk_test_webhooks').webhooks;
  return jest.fn().mockImplementation(() => ({ ...mockStripe, webhooks }));
});

const mockKafkaSend = jest.fn<(record: any) => Promise<void>>();
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: () => ({
      connect: async () => undefined,
      send: mockKafkaSend,
      disconnect: async () => undefined
    })
  }))
}));

const WEBHOOK_SECRET = 'whsec_test_billing';
const USER_ID = '402-00-0001';
const BOOKING_ID = 'bl-booking-1';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'kayak_test'
};

describe('Billing Service Integration Tests', () => {
  let service: BillingService;
  let app: any;
  let db: mysql.Connection;
  let intentCounter = 0;
  const webhooks = new (jest.requireActual<any>('stripe'))('sk_test_signing').webhooks;

  const cleanup = async () => {
    await db.execute("DELETE FROM idempotency_keys WHERE `key` LIKE 'bl-%'");
    await db.execute("DELETE FROM payments WHERE user_id LIKE '402-%'");
    await db.execute("DELETE FROM users WHERE id LIKE '402-%'");
  };

  const insertPayment = (id: string, intentId: string, status: string) =>
    db.execute(
      `INSERT INTO payments (id, user_id, booking_id, amount, currency, status, payment_method, stripe_payment_intent_id)
       VALUES (?, ?, ?, 100.00, 'usd', ?, 'card', ?)`,
      [id, USER_ID, BOOKING_ID, status, intentId]
    );

  const paymentStatus = async (id: string) => {
    const [rows] = await db.execute('SELECT status FROM payments WHERE id = ?', [id]);
    return (rows as any[])[0]?.status;
  };

  const signedWebhook = (event: any, secret = WEBHOOK_SECRET) => {
    const payload = JSON.stringify(event);
    const header = webhooks.generateTestHeaderString({ payload, secret });
    return request(app)
      .post('/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', header)
      .send(payload);
  };

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

    db = await mysql.createConnection(dbConfig);
    await cleanup();
    await db.execute(
      "INSERT INTO users (id, email, first_name, last_name) VALUES (?, 'billing@billing-svc.test', 'Bill', 'Payer')",
      [USER_ID]
    );
    await db.execute(
      `INSERT INTO bookings (id, user_id, type, status, total_amount, currency, confirmation_number)
       VALUES (?, ?, 'flight', 'awaiting_payment', 100.00, 'USD', 'TEMP-bl-1')`,
      [BOOKING_ID, USER_ID]
    );
    await insertPayment('bl-payment-1', 'pi_bl_fixture_1', 'pending');
    await insertPayment('bl-payment-2', 'pi_bl_fixture_2', 'succeeded');
    await insertPayment('bl-payment-3', 'pi_bl_fixture_3', 'pending');
    await insertPayment('bl-payment-4', 'pi_bl_fixture_4', 'pending');

    service = new BillingService();
    await service.init();
    app = service.app;
  });

  afterAll(async () => {
    await cleanup();
    await db.end();
    await (service as any).db.end();
    await (service as any).redis.quit();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  beforeEach(() => {
    mockKafkaSend.mockReset();
    mockKafkaSend.mockResolvedValue(undefined);
    mockStripe.paymentIntents.create.mockReset();
    mockStripe.paymentIntents.create.mockImplementation(async (params: any) => {
      intentCounter += 1;
      const id = `pi_bl_${Date.now()}_${intentCounter}`;
      return {
        id,
        client_secret: `${id}_secret_abc`,
        amount: params.amount,
        currency: params.currency,
        status: 'requires_payment_method',
        metadata: params.metadata
      };
    });
    mockStripe.paymentIntents.retrieve.mockReset();
    mockStripe.paymentIntents.retrieve.mockImplementation(async (id: string) => ({
      id,
      status: 'succeeded',
      amount: 10000,
      currency: 'usd'
    }));
    mockStripe.refunds.create.mockReset();
    mockStripe.refunds.create.mockImplementation(async (params: any) => ({
      id: 're_test_123',
      amount: 10000,
      status: 'succeeded',
      payment_intent: params.payment_intent
    }));
  });

  describe('POST /billing/create-payment-intent', () => {
    it('should create payment intent successfully', async () => {
      const paymentData = {
        amount: 299.99,
        currency: 'usd',
        bookingId: BOOKING_ID,
        userId: USER_ID
      };

      const response = await request(app)
        .post('/billing/create-payment-intent')
        .send(paymentData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('paymentId');
      expect(response.body.data).toHaveProperty('clientSecret');
      expect(response.body.data).toHaveProperty('paymentIntentId');
      expect(response.body.data.clientSecret).toMatch(/_secret_/);
      expect(response.body.data.amount).toBe(299.99);

      // Stripe takes the amount in cents
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 29999,
        currency: 'usd',
        metadata: { bookingId: BOOKING_ID, userId: USER_ID }
      });

      const [rows] = await db.execute('SELECT * FROM payments WHERE id = ?', [response.body.data.paymentId]);
      const row = (rows as any[])[0];
      expect(row.status).toBe('pending');
      expect(Number(row.amount)).toBe(299.99);
      expect(row.stripe_payment_intent_id).toBe(response.body.data.paymentIntentId);
    });

    it('should return the stored response for a repeated idempotency key', async () => {
      const paymentData = { amount: 50, currency: 'usd', bookingId: BOOKING_ID, userId: USER_ID };
      const key = `bl-idem-${Date.now()}`;

      const first = await request(app)
        .post('/billing/create-payment-intent')
        .set('X-Idempotency-Key', key)
        .send(paymentData)
        .expect(201);

      const second = await request(app)
        .post('/billing/create-payment-intent')
        .set('X-Idempotency-Key', key)
        .send(paymentData)
        .expect(201);

      expect(second.body.data.paymentId).toBe(first.body.data.paymentId);
      expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    });

    it('should reject payment intent without required fields', async () => {
      const invalidData = {
        amount: 299.99
        // Missing bookingId and userId
      };

      const response = await request(app)
        .post('/billing/create-payment-intent')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.message).toContain('Amount, userId, and bookingId are required');
    });

    it('should reject a userId that is not an SSN', async () => {
      const response = await request(app)
        .post('/billing/create-payment-intent')
        .send({ amount: 10, currency: 'usd', bookingId: BOOKING_ID, userId: 'user-123' })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_USER_ID');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should handle negative amounts', async () => {
      const invalidData = {
        amount: -50,
        currency: 'usd',
        bookingId: BOOKING_ID,
        userId: USER_ID
      };

      const response = await request(app)
        .post('/billing/create-payment-intent')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('should handle zero amount', async () => {
      const invalidData = {
        amount: 0,
        currency: 'usd',
        bookingId: BOOKING_ID,
        userId: USER_ID
      };

      const response = await request(app)
        .post('/billing/create-payment-intent')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /billing/confirm-payment', () => {
    it('should confirm payment successfully', async () => {
      const confirmData = {
        paymentIntentId: 'pi_bl_fixture_1',
        paymentId: 'bl-payment-1'
      };

      const response = await request(app)
        .post('/billing/confirm-payment')
        .send(confirmData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('status', 'succeeded');
      expect(response.body.data).toHaveProperty('paymentIntent');
      expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_bl_fixture_1');
      expect(await paymentStatus('bl-payment-1')).toBe('succeeded');
    });

    it('should reject confirmation without payment intent ID', async () => {
      const invalidData = {
        paymentId: 'bl-payment-1'
        // Missing paymentIntentId
      };

      const response = await request(app)
        .post('/billing/confirm-payment')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should handle non-existent payment intent', async () => {
      mockStripe.paymentIntents.retrieve.mockRejectedValue(new Error('No such payment_intent'));

      const response = await request(app)
        .post('/billing/confirm-payment')
        .send({ paymentIntentId: 'pi_missing' })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(response.body.error.message).toContain('No such payment_intent');
    });
  });

  describe('POST /billing/refund', () => {
    it('should process refund successfully', async () => {
      const refundData = {
        paymentId: 'bl-payment-2',
        reason: 'requested_by_customer'
      };

      const response = await request(app)
        .post('/billing/refund')
        .send(refundData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('refunded');
      expect(response.body.data).toHaveProperty('refund');
      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_bl_fixture_2',
        reason: 'requested_by_customer'
      });
      expect(await paymentStatus('bl-payment-2')).toBe('refunded');
    });

    it('should reject refund without payment ID', async () => {
      const invalidData = {
        reason: 'requested_by_customer'
        // Missing paymentId
      };

      const response = await request(app)
        .post('/billing/refund')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 404 for non-existent payment', async () => {
      const refundData = {
        paymentId: 'non-existent-payment',
        reason: 'requested_by_customer'
      };

      const response = await request(app)
        .post('/billing/refund')
        .send(refundData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(mockStripe.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /billing/payment/:id', () => {
    it('should get payment by ID', async () => {
      const paymentId = 'bl-payment-4';

      const response = await request(app)
        .get(`/billing/payment/${paymentId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', paymentId);
      expect(response.body.data).toHaveProperty('booking_id', BOOKING_ID);
    });

    it('should return 404 for non-existent payment', async () => {
      const paymentId = 'non-existent-payment';

      const response = await request(app)
        .get(`/billing/payment/${paymentId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /billing/payments', () => {
    it('should get payments with filters', async () => {
      const response = await request(app)
        .get(`/billing/payments?userId=${USER_ID}&status=pending&page=1&limit=10`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      response.body.data.forEach((payment: any) => {
        expect(payment.user_id).toBe(USER_ID);
        expect(payment.status).toBe('pending');
      });
    });

    it('should get all payments without filters', async () => {
      const response = await request(app)
        .get('/billing/payments')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
    });

    it('should handle pagination correctly', async () => {
      const page1 = await request(app)
        .get(`/billing/payments?userId=${USER_ID}&page=1&limit=2`)
        .expect(200);
      const page2 = await request(app)
        .get(`/billing/payments?userId=${USER_ID}&page=2&limit=2`)
        .expect(200);

      expect(page1.body.success).toBe(true);
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data.length).toBeGreaterThan(0);
      const firstIds = page1.body.data.map((p: any) => p.id);
      page2.body.data.forEach((p: any) => expect(firstIds).not.toContain(p.id));
    });
  });

  describe('POST /billing/webhook', () => {
    it('should handle payment_intent.succeeded webhook', async () => {
      const response = await signedWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_bl_fixture_3', status: 'succeeded', amount: 10000 } }
      }).expect(200);

      expect(response.body).toEqual({ received: true });
      expect(await paymentStatus('bl-payment-3')).toBe('succeeded');

      const topics = mockKafkaSend.mock.calls.map(([record]) => record.topic);
      expect(topics).toEqual(['payment.events', 'payment-confirmation']);
      const event = JSON.parse(mockKafkaSend.mock.calls[0][0].messages[0].value);
      expect(event).toMatchObject({ event_type: 'payment_succeeded', booking_id: BOOKING_ID, payment_id: 'bl-payment-3' });
    });

    it('should handle payment_intent.payment_failed webhook', async () => {
      const response = await signedWebhook({
        type: 'payment_intent.payment_failed',
        data: { object: { id: 'pi_bl_fixture_4', status: 'failed', amount: 10000, currency: 'usd' } }
      }).expect(200);

      expect(response.body).toEqual({ received: true });
      expect(await paymentStatus('bl-payment-4')).toBe('failed');
      const event = JSON.parse(mockKafkaSend.mock.calls[0][0].messages[0].value);
      expect(event).toMatchObject({ event_type: 'payment_failed', booking_id: BOOKING_ID, amount: 100 });
    });

    it('should handle unknown webhook types', async () => {
      const response = await signedWebhook({
        type: 'unknown.event.type',
        data: { object: {} }
      }).expect(200);

      expect(response.body).toEqual({ received: true });
      expect(mockKafkaSend).not.toHaveBeenCalled();
    });

    it('should reject invalid webhook signatures', async () => {
      const invalidPayload = {
        type: 'payment_intent.succeeded',
        data: { object: {} }
      };

      const response = await request(app)
        .post('/billing/webhook')
        .set('stripe-signature', 'invalid_signature')
        .send(invalidPayload)
        .expect(400);

      expect(response.text).toContain('Webhook Error');

      // Signed with the wrong secret
      const wrongSecret = await signedWebhook(invalidPayload, 'whsec_wrong').expect(400);
      expect(wrongSecret.text).toContain('Webhook Error');
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.data.service).toBe('billing-svc');
    });
  });

  describe('Error Handling', () => {
    it('should return a structured error for invalid requests', async () => {
      const response = await request(app)
        .post('/billing/create-payment-intent')
        .send({})  // Invalid data to trigger error
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body).toHaveProperty('traceId');
    });

    it('should include trace ID in all responses', async () => {
      const response = await request(app)
        .get('/health')
        .set('X-Trace-Id', 'trace-billing')
        .expect(200);

      expect(response.headers['x-trace-id']).toBe('trace-billing');

      const generated = await request(app).get('/health').expect(200);
      expect(typeof generated.headers['x-trace-id']).toBe('string');
      expect(generated.headers['x-trace-id'].length).toBeGreaterThan(0);
    });
  });
});
