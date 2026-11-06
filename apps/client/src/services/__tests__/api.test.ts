// The shared axios instance in utils/api-client is the network edge for the
// service layer. It is replaced with a stub so no HTTP request is made.
jest.mock('../../utils/api-client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: { request: { use: jest.fn() } },
  },
}));

import api, {
  adminApi,
  airportsApi,
  authApi,
  billingApi,
  bookingApi,
  carsApi,
  conciergeApi,
  flightsApi,
  healthApi,
  hotelsApi,
  userApi,
} from '../api';

interface MockClient {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
  interceptors: { request: { use: jest.Mock } };
}

type RequestConfig = { headers?: Record<string, string> };

const client = jest.requireMock<{ default: MockClient }>('../../utils/api-client').default;
// Captured before any test clears mocks: api.ts registers it once at import.
const traceInterceptor = client.interceptors.request.use.mock.calls[0][0] as (
  config: RequestConfig
) => RequestConfig;

const response = { data: { ok: true } };

beforeEach(() => {
  client.get.mockReset().mockResolvedValue(response);
  client.post.mockReset().mockResolvedValue(response);
  client.put.mockReset().mockResolvedValue(response);
  client.delete.mockReset().mockResolvedValue(response);
});

describe('api client', () => {
  it('re-exports the shared api client', () => {
    expect(api).toBe(client);
  });

  it('registers exactly one request interceptor', () => {
    expect(client.interceptors.request.use.mock.calls).toHaveLength(1);
  });

  it('adds an X-Trace-Id header and keeps existing headers', () => {
    const config: RequestConfig = { headers: { Authorization: 'Bearer t' } };
    const result = traceInterceptor(config);

    expect(result).toBe(config);
    expect(result.headers?.Authorization).toBe('Bearer t');
    expect(result.headers?.['X-Trace-Id']).toMatch(/^client_\d+_[a-z0-9]+$/);
  });

  it('creates the headers object when the request has none', () => {
    const result = traceInterceptor({});
    expect(result.headers?.['X-Trace-Id']).toMatch(/^client_\d+_[a-z0-9]+$/);
  });

  it('gives each request a different trace id', () => {
    const a = traceInterceptor({}).headers?.['X-Trace-Id'];
    const b = traceInterceptor({}).headers?.['X-Trace-Id'];
    expect(a).not.toBe(b);
  });
});

describe('userApi', () => {
  it('maps each call to the users endpoints', async () => {
    await expect(userApi.getUser('u1')).resolves.toBe(response);
    expect(client.get).toHaveBeenCalledWith('/api/users/u1');

    await userApi.createUser({ email: 'a@b.c' });
    expect(client.post).toHaveBeenCalledWith('/api/users', { email: 'a@b.c' });

    await userApi.updateUser('u1', { firstName: 'A' });
    expect(client.put).toHaveBeenCalledWith('/api/users/u1', { firstName: 'A' });

    await userApi.deleteUser('u1');
    expect(client.delete).toHaveBeenCalledWith('/api/users/u1');

    await userApi.searchUsers({ q: 'ann' });
    expect(client.get).toHaveBeenCalledWith('/api/users', { params: { q: 'ann' } });
  });
});

describe('authApi', () => {
  it('maps each call to the auth endpoints', async () => {
    await authApi.login('a@b.c', 'pw');
    expect(client.post).toHaveBeenCalledWith('/api/auth/login', { email: 'a@b.c', password: 'pw' });

    await authApi.register({ email: 'a@b.c' });
    expect(client.post).toHaveBeenCalledWith('/api/auth/register', { email: 'a@b.c' });

    await authApi.refresh();
    expect(client.post).toHaveBeenCalledWith('/api/auth/refresh');

    await authApi.logout();
    expect(client.post).toHaveBeenCalledWith('/api/auth/logout');
  });
});

describe('flightsApi, hotelsApi, carsApi', () => {
  it('maps flight calls', async () => {
    await flightsApi.searchFlights({ origin: 'SFO' });
    expect(client.get).toHaveBeenCalledWith('/api/flights/search', { params: { origin: 'SFO' } });

    await flightsApi.getFlight('f1');
    expect(client.get).toHaveBeenCalledWith('/api/flights/f1');

    await flightsApi.getFlightsByRoute('SFO', 'JFK', { date: '2026-01-01' });
    expect(client.get).toHaveBeenCalledWith('/api/flights/route/SFO/JFK', {
      params: { date: '2026-01-01' },
    });

    await flightsApi.getFlightsByRoute('SFO', 'JFK');
    expect(client.get).toHaveBeenLastCalledWith('/api/flights/route/SFO/JFK', { params: undefined });
  });

  it('maps hotel calls', async () => {
    await hotelsApi.searchHotels({ city: 'Paris' });
    expect(client.get).toHaveBeenCalledWith('/api/hotels/search', { params: { city: 'Paris' } });

    await hotelsApi.getHotel('h1');
    expect(client.get).toHaveBeenCalledWith('/api/hotels/h1');
  });

  it('maps car calls', async () => {
    await carsApi.searchCars({ location: 'LAX' });
    expect(client.get).toHaveBeenCalledWith('/api/cars/search', { params: { location: 'LAX' } });

    await carsApi.getCar('c1');
    expect(client.get).toHaveBeenCalledWith('/api/cars/c1');
  });
});

describe('bookingApi', () => {
  it('sends an idempotency key when creating a booking', async () => {
    const data = { type: 'flight' };
    await bookingApi.createBooking(data);

    expect(client.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = client.post.mock.calls[0];
    expect(url).toBe('/api/bookings');
    expect(body).toBe(data);
    expect(config.headers['X-Idempotency-Key']).toMatch(/^booking_\d+_[a-z0-9]+$/);
  });

  it('uses a fresh idempotency key for each booking', async () => {
    await bookingApi.createBooking({});
    await bookingApi.createBooking({});
    const keys = client.post.mock.calls.map((call) => call[2].headers['X-Idempotency-Key']);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('maps the other booking calls', async () => {
    await bookingApi.getBooking('b1');
    expect(client.get).toHaveBeenCalledWith('/api/bookings/b1');

    await bookingApi.getUserBookings('u1');
    expect(client.get).toHaveBeenCalledWith('/api/bookings/user/u1');

    await bookingApi.cancelBooking('b1');
    expect(client.put).toHaveBeenCalledWith('/api/bookings/b1/cancel');

    await bookingApi.updateBooking('b1', { status: 'confirmed' });
    expect(client.put).toHaveBeenCalledWith('/api/bookings/b1', { status: 'confirmed' });
  });
});

describe('billingApi and conciergeApi', () => {
  it('maps billing calls', async () => {
    await billingApi.createPaymentIntent({ amount: 100 });
    expect(client.post).toHaveBeenCalledWith('/api/billing/create-payment-intent', { amount: 100 });

    await billingApi.getPayment('p1');
    expect(client.get).toHaveBeenCalledWith('/api/billing/payment/p1');
  });

  it('maps concierge calls', async () => {
    await conciergeApi.getBundles({ budget: 500 });
    expect(client.post).toHaveBeenCalledWith('/api/concierge/bundles', { budget: 500 });

    await conciergeApi.getDeals();
    expect(client.get).toHaveBeenCalledWith('/api/concierge/deals');

    await conciergeApi.createWatch({ user_id: 'u1' });
    expect(client.post).toHaveBeenCalledWith('/api/concierge/watch', { user_id: 'u1' });

    await conciergeApi.chat('hello');
    expect(client.post).toHaveBeenCalledWith('/api/concierge/chat', { message: 'hello' });
  });
});

describe('adminApi', () => {
  it('maps each call to the admin endpoints', async () => {
    await adminApi.getStats();
    expect(client.get).toHaveBeenCalledWith('/api/admin/stats');

    await adminApi.getUsers({ page: 2 });
    expect(client.get).toHaveBeenCalledWith('/api/admin/users', { params: { page: 2 } });

    await adminApi.getBookings({ status: 'pending' });
    expect(client.get).toHaveBeenCalledWith('/api/admin/bookings', { params: { status: 'pending' } });

    await adminApi.createListing({ type: 'hotel' });
    expect(client.post).toHaveBeenCalledWith('/api/admin/listings', { type: 'hotel' });
  });
});

describe('airportsApi and healthApi', () => {
  it('passes query, limit and abort signal to suggest', async () => {
    const controller = new AbortController();
    await airportsApi.suggest('lon', 5, controller.signal);
    expect(client.get).toHaveBeenCalledWith('/api/airports/suggest', {
      params: { q: 'lon', limit: 5 },
      signal: controller.signal,
    });
  });

  it('maps the other airport calls', async () => {
    await airportsApi.resolve('London');
    expect(client.get).toHaveBeenCalledWith('/api/airports/resolve', { params: { q: 'London' } });

    await airportsApi.getAirport('LHR');
    expect(client.get).toHaveBeenCalledWith('/api/airports/LHR');

    await airportsApi.getNearby('LHR');
    expect(client.get).toHaveBeenCalledWith('/api/airports/LHR/nearby');
  });

  it('checks health', async () => {
    await healthApi.check();
    expect(client.get).toHaveBeenCalledWith('/health');
  });
});
