import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import mysql from 'mysql2/promise';

/**
 * End-to-end tests against the running Docker Compose stack, through the API gateway.
 * Run with: docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d && npm run test:e2e
 *
 * The compose database starts empty, so this suite seeds its own flights and hotel
 * straight into MySQL. User IDs are SSNs; this suite owns the 501-00-xxxx range.
 */
const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:8000';
const mailUrl = process.env.MAILPIT_URL || 'http://localhost:8025';

const dbConfig = {
  host: process.env.E2E_DB_HOST || 'localhost',
  user: process.env.E2E_DB_USER || 'kayak',
  password: process.env.E2E_DB_PASSWORD || 'change_me_db_password',
  database: process.env.E2E_DB_NAME || 'kayak'
};

const CUSTOMER = { ssn: '501-00-0001', email: 'customer@e2e.test' };
const ADMIN = { ssn: '501-00-0002', email: 'admin@e2e.test' };
const FLIGHT_ID = 'e2e-flight-1';
const FLIGHT_PRICE = 320.5;
const ROOM_ID = 'e2e-room-1';
const ROOM_PRICE = 189;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('End-to-End Booking Flow Tests', () => {
  let db: mysql.Connection;
  let customerToken: string;
  let adminToken: string;

  const api = () => request(gatewayUrl);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const cleanup = async () => {
    await db.execute('DELETE FROM flight_reservations WHERE flight_id = ?', [FLIGHT_ID]);
    await db.execute('DELETE FROM hotel_reservations WHERE room_id = ?', [ROOM_ID]);
    await db.execute("DELETE FROM users WHERE id LIKE '501-00-%' OR email LIKE '%@e2e.test'");
    await db.execute('DELETE FROM flights WHERE id = ?', [FLIGHT_ID]);
    await db.execute("DELETE FROM hotels WHERE id = 'e2e-hotel-1'");
  };

  const register = async (user: { ssn: string; email: string }, firstName: string) => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: user.email, password: 'SecurePassword123!', firstName, lastName: 'E2E', phone: '+1234567890', ssn: user.ssn })
      .expect(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.id).toBe(user.ssn);
    expect(typeof response.body.data.accessToken).toBe('string');
    return response.body.data.accessToken as string;
  };

  // Payment is confirmed asynchronously (billing-svc -> Kafka -> booking-svc)
  const waitForBookingStatus = async (bookingId: string, token: string, status: string) => {
    let booking: any;
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await api().get(`/api/bookings/${bookingId}`).set(auth(token)).expect(200);
      booking = response.body.data;
      if (booking.status === status) return booking;
      await sleep(500);
    }
    throw new Error(`Booking ${bookingId} stayed ${booking?.status}, expected ${status}`);
  };

  beforeAll(async () => {
    db = await mysql.createConnection(dbConfig);
    await cleanup();
    await db.execute(
      `INSERT INTO flights (id, airline, flight_number, origin_airport_code, destination_airport_code,
                            departure_time, arrival_time, duration_minutes, aircraft, price, currency,
                            available_seats, class)
       VALUES (?, 'Delta Airlines', 'DL999', 'JFK', 'LAX', '2026-12-15 08:00:00', '2026-12-15 13:30:00',
               330, 'Boeing 737', ?, 'USD', 150, 'economy')`,
      [FLIGHT_ID, FLIGHT_PRICE]
    );
    await db.execute(
      `INSERT INTO hotels (id, name, description, star_rating, address_street, address_city, address_state,
                           address_zip_code, average_price)
       VALUES ('e2e-hotel-1', 'E2E Grand Plaza', 'Test hotel', 4, '123 Main St', 'Los Angeles', 'CA', '90012', ?)`,
      [ROOM_PRICE]
    );
    await db.execute(
      `INSERT INTO hotel_rooms (id, hotel_id, type, max_occupancy, beds, available_rooms, base_price, price_per_night, amenities)
       VALUES (?, 'e2e-hotel-1', 'Deluxe King', 2, '1 King', 5, ?, ?, ?)`,
      [ROOM_ID, ROOM_PRICE, ROOM_PRICE, JSON.stringify(['wifi'])]
    );

    customerToken = await register(CUSTOMER, 'Casey');
    adminToken = await register(ADMIN, 'Avery');
    // admin-svc reads the role from the users table on every request
    await db.execute("UPDATE users SET role = 'admin' WHERE id = ?", [ADMIN.ssn]);
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await db.end();
  });

  describe('Complete Booking Journey', () => {
    it('should complete full booking flow: search → book → pay → confirm', async () => {
      // Step 1: Search flights
      const searchResponse = await api()
        .post('/api/flights/search')
        .set(auth(customerToken))
        .send({ origin: 'JFK', destination: 'LAX', departureDate: '2026-12-15', passengers: 2, maxPrice: 1000 })
        .expect(200);

      expect(searchResponse.body.success).toBe(true);
      const selectedFlight = searchResponse.body.data.flights.find((f: any) => f.id === FLIGHT_ID);
      expect(selectedFlight).toBeDefined();
      expect(Number(selectedFlight.price)).toBe(FLIGHT_PRICE);

      // Step 2: Book two seats; the price comes from flights-svc, not the client
      const bookingResponse = await api()
        .post('/api/bookings')
        .set(auth(customerToken))
        .send({
          userId: CUSTOMER.ssn,
          type: 'flight',
          items: [{ type: 'flight', referenceId: FLIGHT_ID, quantity: 2, unitPrice: 1 }],
          currency: 'USD'
        })
        .expect(201);

      expect(bookingResponse.body.success).toBe(true);
      const booking = bookingResponse.body.data;
      expect(booking.totalAmount).toBe(FLIGHT_PRICE * 2);
      // Mock payment can confirm the booking before this response is built
      expect(['awaiting_payment', 'confirmed']).toContain(booking.status);
      expect([`TEMP-${booking.id.slice(0, 8)}`, `KAYAK-${booking.id.slice(0, 8).toUpperCase()}`]).toContain(booking.confirmationNumber);
      expect(booking.clientSecret).toMatch(/secret/);

      // Step 3: The seats are held on the flight
      const flightResponse = await api().get(`/api/flights/${FLIGHT_ID}`).expect(200);
      expect(flightResponse.body.data.availableSeats).toBe(148);

      // Step 4: Payment succeeds (mock Stripe in compose) and the booking is confirmed over Kafka
      const confirmed = await waitForBookingStatus(booking.id, customerToken, 'confirmed');
      expect(confirmed.confirmation_number).toBe(`KAYAK-${booking.id.slice(0, 8).toUpperCase()}`);

      const paymentResponse = await api()
        .get(`/api/billing/payment/${booking.paymentId}`)
        .set(auth(customerToken))
        .expect(200);
      expect(paymentResponse.body.data.status).toBe('succeeded');
      expect(paymentResponse.body.data.booking_id).toBe(booking.id);
      expect(Number(paymentResponse.body.data.amount)).toBe(FLIGHT_PRICE * 2);

      // Step 5: The booking shows up in the user's list, with its items
      const userBookingsResponse = await api()
        .get(`/api/bookings/user/${CUSTOMER.ssn}`)
        .set(auth(customerToken))
        .expect(200);

      const listed = userBookingsResponse.body.data.find((b: any) => b.id === booking.id);
      expect(listed).toBeDefined();
      expect(listed.status).toBe('confirmed');
      expect(listed.items).toEqual([
        expect.objectContaining({ type: 'flight', referenceId: FLIGHT_ID, quantity: 2, totalPrice: FLIGHT_PRICE * 2 })
      ]);
    }, 60000);
  });

  describe('Package Booking Flow', () => {
    it('should complete package booking: flight + hotel', async () => {
      const hotelResponse = await api()
        .post('/api/hotels/search')
        .set(auth(customerToken))
        .send({ destination: 'Los Angeles', checkInDate: '2026-12-15', checkOutDate: '2026-12-18', starRating: [4, 5] })
        .expect(200);

      expect(hotelResponse.body.success).toBe(true);
      const selectedRoom = hotelResponse.body.data.hotels.find((h: any) => h.id === ROOM_ID);
      expect(selectedRoom).toBeDefined();
      expect(Number(selectedRoom.pricePerNight)).toBe(ROOM_PRICE);

      const bookingResponse = await api()
        .post('/api/bookings')
        .set(auth(customerToken))
        .send({
          userId: CUSTOMER.ssn,
          type: 'package',
          items: [
            { type: 'flight', referenceId: FLIGHT_ID, quantity: 1 },
            { type: 'hotel', referenceId: ROOM_ID, startDate: '2026-12-15', endDate: '2026-12-18' }
          ],
          currency: 'USD'
        })
        .expect(201);

      expect(bookingResponse.body.success).toBe(true);
      expect(bookingResponse.body.data.type).toBe('package');
      expect(bookingResponse.body.data.items).toHaveLength(2);
      // One seat plus three nights
      expect(bookingResponse.body.data.totalAmount).toBeCloseTo(FLIGHT_PRICE + ROOM_PRICE * 3, 2);

      await waitForBookingStatus(bookingResponse.body.data.id, customerToken, 'confirmed');
    }, 60000);
  });

  describe('Deal Recommendation Flow', () => {
    it('should get personalized deal recommendations', async () => {
      const response = await api()
        .get(`/api/deals/recommendations?userId=${CUSTOMER.ssn}&limit=5`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('deals');
      expect(Array.isArray(response.body.data.deals)).toBe(true);
      expect(response.body.data.deals.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Concierge Service Flow', () => {
    it('should get bundle recommendations from concierge', async () => {
      const bundleRequest = {
        origin: 'JFK',
        destination: 'CDG',
        departure_date: '2026-12-15T00:00:00.000Z',
        return_date: '2026-12-22T00:00:00.000Z',
        budget: 2000,
        preferences: {
          flight_class: 'economy',
          hotel_star_rating: [4, 5],
          amenities: ['wifi'],
          pet_friendly: false,
          avoid_red_eye: true
        },
        constraints: {
          adults: 2,
          children: 0,
          rooms: 1
        }
      };

      const response = await api()
        .post('/api/concierge/bundles')
        .set(auth(customerToken))
        .send(bundleRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.bundles)).toBe(true);
      expect(response.body.data.bundles.length).toBeGreaterThan(0);
      response.body.data.bundles.forEach((bundle: any) => {
        expect(bundle.destination).toBe('CDG');
        expect(bundle.total_price).toBeLessThanOrEqual(bundleRequest.budget);
        expect(bundle.components.map((c: any) => c.type)).toEqual(expect.arrayContaining(['flight', 'hotel']));
      });
    }, 60000);
  });

  describe('Notification Flow', () => {
    it('should send booking confirmation notification', async () => {
      const subject = `Booking Confirmed ${Date.now()}`;
      const response = await api()
        .post('/api/notifications/send')
        .set(auth(customerToken))
        .send({
          userId: CUSTOMER.ssn,
          type: 'booking_confirmation',
          recipient: CUSTOMER.email,
          subject,
          message: 'Your booking has been confirmed',
          bookingId: 'booking-123'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(typeof response.body.data.notificationId).toBe('string');

      const [rows] = await db.execute('SELECT recipient, status FROM notifications WHERE id = ?', [response.body.data.notificationId]);
      expect(rows).toEqual([{ recipient: CUSTOMER.email, status: 'sent' }]);

      // The email reached the mail catcher
      const mail = await request(mailUrl).get('/api/v1/messages').expect(200);
      const delivered = mail.body.messages.find((m: any) => m.Subject === subject);
      expect(delivered).toBeDefined();
      expect(delivered.To.map((t: any) => t.Address)).toEqual([CUSTOMER.email]);
    });
  });

  describe('Admin Dashboard Flow', () => {
    it('should get admin statistics', async () => {
      const response = await api()
        .get('/api/admin/stats')
        .set(auth(adminToken))
        .expect(200);

      expect(response.body.success).toBe(true);
      for (const key of ['users', 'bookings', 'flights', 'hotels', 'cars']) {
        expect(typeof response.body.data[key]).toBe('number');
      }
      expect(response.body.data.users).toBeGreaterThanOrEqual(2);
      expect(response.body.data.flights).toBeGreaterThanOrEqual(1);
    });

    it('should get paginated admin data', async () => {
      const response = await api()
        .get('/api/admin/users?page=1&limit=10')
        .set(auth(adminToken))
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
    });

    it('should refuse admin data to a regular user', async () => {
      const response = await api()
        .get('/api/admin/stats')
        .set(auth(customerToken))
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle booking and payment failures', async () => {
      // A flight that does not exist cannot be priced, so nothing is booked
      const unknownFlight = await api()
        .post('/api/bookings')
        .set(auth(customerToken))
        .send({ userId: CUSTOMER.ssn, items: [{ type: 'flight', referenceId: 'no-such-flight', quantity: 1 }] })
        .expect(500);
      expect(unknownFlight.body.success).toBe(false);
      expect(unknownFlight.body.error.code).toBe('BOOKING_FAILED');

      // A user ID that is not an SSN is rejected up front
      const badUser = await api()
        .post('/api/bookings')
        .set(auth(customerToken))
        .send({ userId: 'user-123', items: [{ type: 'flight', referenceId: FLIGHT_ID, quantity: 1 }] })
        .expect(400);
      expect(badUser.body.error.code).toBe('INVALID_USER_ID');

      // Billing refuses a payment with no positive amount
      const badPayment = await api()
        .post('/api/billing/create-payment-intent')
        .set(auth(customerToken))
        .send({ amount: 0.0, currency: 'usd', bookingId: 'booking-123', userId: CUSTOMER.ssn })
        .expect(400);
      expect(badPayment.body.success).toBe(false);
      expect(badPayment.body.error.code).toBe('BAD_REQUEST');
    });

    it('should reject requests without a token', async () => {
      const response = await api()
        .post('/api/bookings')
        .send({ userId: CUSTOMER.ssn, items: [{ type: 'flight', referenceId: FLIGHT_ID }] })
        .expect(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle service unavailability', async () => {
      // airport-resolver-svc is not part of the compose stack, so the gateway cannot reach it
      const response = await api()
        .get('/api/airports/search?q=JFK')
        .expect(502);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_GATEWAY');
    });
  });
});
