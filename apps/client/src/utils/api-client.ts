import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';

const isDemoMode = (import.meta.env.VITE_DEMO_MODE as string | undefined)?.toLowerCase() === 'true';

const DEMO_TOKENS = {
  accessToken: 'demo-access-token',
  refreshToken: 'demo-refresh-token',
};

const DEMO_USER_FALLBACK = {
  id: 'demo-user',
  email: 'demo@kayak.local',
  firstName: 'Demo',
  lastName: 'User',
  role: 'user',
};

const DEMO_BOOKINGS_KEY = 'demo_kayak_bookings_v1';

type Json = Record<string, any>;

type AnyAxiosConfig = AxiosRequestConfig & {
  _retry?: boolean;
};

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getStoredUser(): any {
  if (typeof localStorage === 'undefined') {
    return DEMO_USER_FALLBACK;
  }
  const stored = safeJsonParse<any>(localStorage.getItem('user'), null);
  return stored || DEMO_USER_FALLBACK;
}

function getNowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function normalizePath(url: string | undefined): string {
  const raw = (url || '').trim();
  if (!raw) return '/';

  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const parsed = new URL(raw);
      return parsed.pathname || '/';
    }
  } catch {
    // ignore
  }

  const withoutQuery = raw.split('?')[0] || '/';
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

function parseBody(config: AxiosRequestConfig): any {
  const data = (config as any).data;
  if (!data) return undefined;
  if (typeof data === 'string') {
    return safeJsonParse<any>(data, data);
  }
  return data;
}

function buildClientHref(path: string): string {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  const routerMode = (import.meta.env.VITE_ROUTER_MODE as string | undefined)?.toLowerCase();

  if (routerMode === 'hash') {
    return `${base}#/${normalized}`;
  }

  return `${base}${normalized}`;
}

function ok<T>(config: AxiosRequestConfig, payload: T, status = 200): AxiosResponse<T> {
  return {
    data: payload,
    status,
    statusText: 'OK',
    headers: {},
    config: config as any,
  };
}

function okData(config: AxiosRequestConfig, payload: Json): AxiosResponse<Json> {
  return ok(config, { data: payload });
}

function getDemoBookings(): any[] {
  if (typeof localStorage === 'undefined') return [];
  return safeJsonParse<any[]>(localStorage.getItem(DEMO_BOOKINGS_KEY), []);
}

function setDemoBookings(bookings: any[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DEMO_BOOKINGS_KEY, JSON.stringify(bookings));
}

const demoAdapter: AxiosAdapter = async (config) => {
  const method = (config.method || 'get').toLowerCase();
  const path = normalizePath(config.url);
  const params = (config.params || {}) as any;
  const body = parseBody(config);

  // Health
  if (path === '/health') {
    return okData(config, { status: 'ok', demo: true, time: getNowIso() });
  }

  // Auth
  if ((path === '/api/auth/login' || path === '/auth/login') && method === 'post') {
    const user = getStoredUser();
    return okData(config, {
      user,
      accessToken: DEMO_TOKENS.accessToken,
      refreshToken: DEMO_TOKENS.refreshToken,
    });
  }

  if ((path === '/api/auth/register' || path === '/auth/register') && method === 'post') {
    const user = {
      ...getStoredUser(),
      ...(body || {}),
      id: getStoredUser().id || 'demo-user',
      role: 'user',
    };
    return okData(config, {
      user,
      accessToken: DEMO_TOKENS.accessToken,
      refreshToken: DEMO_TOKENS.refreshToken,
    });
  }

  if (path === '/api/auth/refresh' && method === 'post') {
    const user = getStoredUser();
    return okData(config, {
      user,
      accessToken: DEMO_TOKENS.accessToken,
      refreshToken: DEMO_TOKENS.refreshToken,
    });
  }

  if (path === '/api/auth/logout' && method === 'post') {
    return okData(config, { success: true });
  }

  // Users
  if (path.startsWith('/api/users/') && method === 'get') {
    const id = path.split('/').pop() || 'demo-user';
    return okData(config, { user: { ...getStoredUser(), id } });
  }

  if (path.startsWith('/api/users/') && method === 'put') {
    const id = path.split('/').pop() || 'demo-user';
    const updated = { ...getStoredUser(), ...(body || {}), id };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('user', JSON.stringify(updated));
    }
    return okData(config, { user: updated });
  }

  if (path === '/api/users' && method === 'get') {
    return okData(config, { users: [getStoredUser()] });
  }

  // Airports
  if (path === '/api/airports/suggest' && method === 'get') {
    const qRaw = (params.q || params.query || '').toString();
    const q = qRaw.trim().toLowerCase();
    const limit = Math.max(1, Math.min(10, Number(params.limit) || 8));

    const airports = [
      { iata: 'SFO', name: 'San Francisco International Airport', city: 'San Francisco', state: 'CA', country: 'USA', timezone: 'America/Los_Angeles', latitude: 37.6213, longitude: -122.3790 },
      { iata: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles', state: 'CA', country: 'USA', timezone: 'America/Los_Angeles', latitude: 33.9416, longitude: -118.4085 },
      { iata: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', state: 'NY', country: 'USA', timezone: 'America/New_York', latitude: 40.6413, longitude: -73.7781 },
      { iata: 'SEA', name: 'Seattle–Tacoma International Airport', city: 'Seattle', state: 'WA', country: 'USA', timezone: 'America/Los_Angeles', latitude: 47.4502, longitude: -122.3088 },
      { iata: 'ORD', name: 'O\'Hare International Airport', city: 'Chicago', state: 'IL', country: 'USA', timezone: 'America/Chicago', latitude: 41.9742, longitude: -87.9073 },
      { iata: 'ATL', name: 'Hartsfield–Jackson Atlanta International Airport', city: 'Atlanta', state: 'GA', country: 'USA', timezone: 'America/New_York', latitude: 33.6407, longitude: -84.4277 },
      { iata: 'DFW', name: 'Dallas/Fort Worth International Airport', city: 'Dallas', state: 'TX', country: 'USA', timezone: 'America/Chicago', latitude: 32.8998, longitude: -97.0403 },
      { iata: 'BOS', name: 'Boston Logan International Airport', city: 'Boston', state: 'MA', country: 'USA', timezone: 'America/New_York', latitude: 42.3656, longitude: -71.0096 },
    ];

    const matches = airports
      .map((a) => {
        const label = `${a.city} (${a.iata}) — ${a.name}`;
        const haystack = `${a.iata} ${a.city} ${a.name} ${a.state || ''} ${a.country}`.toLowerCase();
        const hit = q.length === 0 ? true : haystack.includes(q);
        const score = q.length === 0 ? 50 : (hit ? 90 : 0);
        return {
          ...a,
          label,
          score,
          matchedField: q.length === 0 ? 'all' : (a.iata.toLowerCase().includes(q) ? 'iata' : 'name'),
        };
      })
      .filter((a) => q.length === 0 || a.score > 0)
      .slice(0, limit);

    return okData(config, { suggestions: matches });
  }

  if (path === '/api/airports/resolve' && method === 'get') {
    const qRaw = (params.q || params.query || '').toString();
    const q = qRaw.trim().toUpperCase();
    return okData(config, {
      airport: {
        iata: q || 'SFO',
        name: q ? `${q} Airport` : 'San Francisco International Airport',
        city: q ? 'City' : 'San Francisco',
        country: 'USA',
        latitude: 37.6213,
        longitude: -122.3790,
      },
    });
  }

  if (/^\/api\/airports\/[A-Z0-9]{3}$/i.test(path) && method === 'get') {
    const code = path.split('/').pop()!.toUpperCase();
    return okData(config, {
      airport: {
        iata: code,
        name: `${code} Airport`,
        city: 'City',
        country: 'USA',
        latitude: 0,
        longitude: 0,
      },
    });
  }

  if (/^\/api\/airports\/[A-Z0-9]{3}\/nearby$/i.test(path) && method === 'get') {
    const code = path.split('/')[3].toUpperCase();
    return okData(config, {
      nearby: [
        { iata: code, name: `${code} Airport`, city: 'City', country: 'USA', distanceMiles: 0 },
      ],
    });
  }

  // Flights
  if (path === '/api/flights/search' && method === 'get') {
    const origin = (params.origin || 'SFO').toString().toUpperCase();
    const destination = (params.destination || 'LAX').toString().toUpperCase();
    const departureDate = (params.departureDate || params.depart_date || '2026-01-15').toString();

    const flights = [
      {
        id: makeId('flt'),
        airline: 'Delta',
        flightNumber: 'DL 421',
        origin,
        destination,
        departureTime: `${departureDate}T08:20:00`,
        arrivalTime: `${departureDate}T10:01:00`,
        duration: 101,
        stops: 0,
        price: 189,
        cabinClass: 'Economy',
      },
      {
        id: makeId('flt'),
        airline: 'United',
        flightNumber: 'UA 118',
        origin,
        destination,
        departureTime: `${departureDate}T11:10:00`,
        arrivalTime: `${departureDate}T13:10:00`,
        duration: 120,
        stops: 0,
        price: 219,
        cabinClass: 'Economy',
      },
      {
        id: makeId('flt'),
        airline: 'American',
        flightNumber: 'AA 902',
        origin,
        destination,
        departureTime: `${departureDate}T15:35:00`,
        arrivalTime: `${departureDate}T18:05:00`,
        duration: 150,
        stops: 1,
        price: 169,
        cabinClass: 'Economy',
      },
      {
        id: makeId('flt'),
        airline: 'JetBlue',
        flightNumber: 'B6 77',
        origin,
        destination,
        departureTime: `${departureDate}T19:00:00`,
        arrivalTime: `${departureDate}T21:05:00`,
        duration: 125,
        stops: 0,
        price: 205,
        cabinClass: 'Economy',
      },
    ];

    return okData(config, { flights });
  }

  if (/^\/api\/flights\/route\/[^/]+\/[^/]+$/i.test(path) && method === 'get') {
    const parts = path.split('/');
    const origin = (parts[4] || 'SFO').toUpperCase();
    const destination = (parts[5] || 'LAX').toUpperCase();
    const flights = [
      {
        id: makeId('flt'),
        airline: 'United',
        flightNumber: 'UA 118',
        origin,
        destination,
        departureTime: '2026-01-15T11:10:00',
        arrivalTime: '2026-01-15T13:10:00',
        duration: 120,
        stops: 0,
        price: 219,
        cabinClass: 'Economy',
      },
      {
        id: makeId('flt'),
        airline: 'Delta',
        flightNumber: 'DL 421',
        origin,
        destination,
        departureTime: '2026-01-15T08:20:00',
        arrivalTime: '2026-01-15T10:01:00',
        duration: 101,
        stops: 0,
        price: 189,
        cabinClass: 'Economy',
      },
    ];

    return okData(config, { flights });
  }

  if (/^\/api\/flights\/[^/]+$/i.test(path) && method === 'get') {
    const id = path.split('/').pop() || makeId('flt');
    return okData(config, {
      id,
      airline: 'Delta',
      flightNumber: 'DL 421',
      origin: 'SFO',
      destination: 'LAX',
      departureTime: '2026-01-15T08:20:00',
      arrivalTime: '2026-01-15T10:01:00',
      duration: 101,
      stops: 0,
      price: 189,
      cabinClass: 'Economy',
    });
  }

  // Hotels
  if (path === '/api/hotels/search' && method === 'get') {
    const destination = (params.destination || params.location || 'San Francisco').toString();
    const hotels = [
      {
        id: makeId('htl'),
        name: 'Harborview Hotel',
        destination,
        neighborhood: 'Downtown',
        starRating: 4,
        reviewScore: 9.1,
        reviewsCount: 1240,
        pricePerNight: 179,
        amenities: ['WiFi', 'Gym', 'Breakfast'],
        imageUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=60',
      },
      {
        id: makeId('htl'),
        name: 'City Lights Suites',
        destination,
        neighborhood: 'Waterfront',
        starRating: 5,
        reviewScore: 9.4,
        reviewsCount: 860,
        pricePerNight: 249,
        amenities: ['WiFi', 'Pool', 'Spa'],
        imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=60',
      },
      {
        id: makeId('htl'),
        name: 'Budget Stay Inn',
        destination,
        neighborhood: 'Midtown',
        starRating: 3,
        reviewScore: 8.2,
        reviewsCount: 430,
        pricePerNight: 99,
        amenities: ['WiFi'],
        imageUrl: 'https://images.unsplash.com/photo-1551887373-6d63f4a8b9c3?auto=format&fit=crop&w=1200&q=60',
      },
    ];

    return okData(config, { hotels });
  }

  if (/^\/api\/hotels\/[^/]+$/i.test(path) && method === 'get') {
    const id = path.split('/').pop() || makeId('htl');
    return okData(config, {
      id,
      name: 'Harborview Hotel',
      destination: 'San Francisco',
      neighborhood: 'Downtown',
      starRating: 4,
      reviewScore: 9.1,
      reviewsCount: 1240,
      pricePerNight: 179,
      address: '100 Market St, San Francisco, CA',
      amenities: ['WiFi', 'Gym', 'Breakfast'],
    });
  }

  // Cars
  if (path === '/api/cars/search' && method === 'get') {
    const location = (params.location || params.destination || 'San Francisco').toString();
    const cars = [
      {
        id: makeId('car'),
        location,
        make: 'Toyota',
        model: 'Corolla',
        carType: 'Compact',
        transmission: 'Automatic',
        seats: 5,
        dailyRate: 45,
        supplier: 'Hertz',
        imageUrl: 'https://images.unsplash.com/photo-1542282088-fe8426682b8f?auto=format&fit=crop&w=1200&q=60',
      },
      {
        id: makeId('car'),
        location,
        make: 'Tesla',
        model: 'Model 3',
        carType: 'Electric',
        transmission: 'Automatic',
        seats: 5,
        dailyRate: 89,
        supplier: 'Avis',
        imageUrl: 'https://images.unsplash.com/photo-1619767886558-efdc259cde1b?auto=format&fit=crop&w=1200&q=60',
      },
      {
        id: makeId('car'),
        location,
        make: 'Ford',
        model: 'Explorer',
        carType: 'SUV',
        transmission: 'Automatic',
        seats: 7,
        dailyRate: 78,
        supplier: 'Enterprise',
        imageUrl: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=1200&q=60',
      },
    ];

    return okData(config, { cars });
  }

  // Bookings
  if (path === '/api/bookings' && method === 'post') {
    const now = getNowIso();
    const booking = {
      id: makeId('bkg'),
      confirmationNumber: `CNF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
      ...body,
      clientSecret: `pi_mock_secret_${Date.now()}`,
    };

    const bookings = getDemoBookings();
    bookings.unshift(booking);
    setDemoBookings(bookings.slice(0, 25));

    return okData(config, booking);
  }

  if (/^\/api\/bookings\/user\/.+/.test(path) && method === 'get') {
    const bookings = getDemoBookings();
    return okData(config, { bookings });
  }

  if (/^\/api\/bookings\/.+/.test(path) && method === 'get') {
    const id = path.split('/').pop();
    const bookings = getDemoBookings();
    const found = bookings.find((b) => b.id === id);
    return okData(config, found || null);
  }

  // Billing
  if (path === '/api/billing/create-payment-intent' && method === 'post') {
    return okData(config, {
      clientSecret: `pi_mock_secret_${Date.now()}`,
      amount: body?.amount || 0,
      currency: body?.currency || 'USD',
    });
  }

  // Concierge
  if (path === '/api/concierge/deals' && method === 'get') {
    const now = Date.now();
    const deals = [
      {
        id: 'deal_1',
        type: 'flight',
        title: 'West Coast Weekend Saver',
        description: 'Round-trip flight deal with flexible dates.',
        originalPrice: 299,
        discountedPrice: 199,
        discountPercentage: 33,
        destination: 'LAX',
        expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 3).toISOString(),
        score: 92,
        tags: ['popular', 'limited-time'],
      },
      {
        id: 'deal_2',
        type: 'hotel',
        title: 'Luxury Stay Upgrade',
        description: '5-star hotel discount with breakfast included.',
        originalPrice: 320,
        discountedPrice: 249,
        discountPercentage: 22,
        destination: 'San Francisco',
        expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 5).toISOString(),
        score: 88,
        tags: ['top-rated'],
      },
      {
        id: 'deal_3',
        type: 'car',
        title: 'SUV Special',
        description: 'Discounted SUV rentals for family trips.',
        originalPrice: 95,
        discountedPrice: 78,
        discountPercentage: 18,
        destination: 'SEA',
        expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 2).toISOString(),
        score: 84,
        tags: ['best-value'],
      },
    ];

    return okData(config, { deals });
  }

  if (path === '/api/concierge/bundles' && method === 'post') {
    const bundles = [
      {
        id: makeId('bundle'),
        title: 'City Lights Bundle',
        summary: 'Flight + Hotel bundle optimized for price and convenience.',
        total: 699,
        currency: 'USD',
      },
      {
        id: makeId('bundle'),
        title: 'Comfort & Convenience',
        summary: 'Premium hotel + flexible flight times.',
        total: 899,
        currency: 'USD',
      },
    ];

    return okData(config, { bundles });
  }

  if (path === '/api/concierge/watch' && method === 'post') {
    return okData(config, {
      watch: {
        id: makeId('watch'),
        createdAt: getNowIso(),
        ...(body || {}),
      },
    });
  }

  if (path === '/api/concierge/chat' && method === 'post') {
    const message = (body?.message || '').toString();
    const bundles = {
      bundles: [
        {
          id: makeId('bundle'),
          title: 'Demo Bundle',
          summary: 'Curated demo bundle based on your preferences.',
          total: 799,
          currency: 'USD',
        },
      ],
    };

    return okData(config, {
      message: message
        ? `Got it — here are a few demo options for: "${message}"`
        : 'Got it — here are a few demo options.',
      bundles,
    });
  }

  // Default: return a harmless demo response
  return okData(config, {
    demo: true,
    unimplemented: true,
    path,
    method,
  });
};

const apiClient = axios.create({
  baseURL: isDemoMode ? '' : import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  adapter: isDemoMode ? demoAdapter : undefined,
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh and errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AnyAxiosConfig;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          // Use apiClient instead of axios to ensure baseURL is used
          const response = await apiClient.post('/api/auth/refresh', {
            refreshToken,
          });

          const { accessToken } = response.data.data;
          localStorage.setItem('accessToken', accessToken);

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // Refresh token failed, redirect to login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = buildClientHref('/login');
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// API endpoints
export const api = {
  // Auth
  login: (credentials: { email: string; password: string }) =>
    apiClient.post('/auth/login', credentials),
  
  register: (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => apiClient.post('/auth/register', userData),

  // Flights
  searchFlights: (params: any) =>
    apiClient.post('/flights/search', params),
  
  getFlight: (id: string) =>
    apiClient.get(`/flights/${id}`),

  // Bookings
  createBooking: (bookingData: any) =>
    apiClient.post('/bookings', bookingData),
  
  getUserBookings: () =>
    apiClient.get('/bookings'),

  // Payments
  createPaymentIntent: (amount: number, currency: string) =>
    apiClient.post('/payments/intent', { amount, currency }),

  // User
  getUserProfile: () =>
    apiClient.get('/users/profile'),
  
  updateUserProfile: (data: any) =>
    apiClient.put('/users/profile', data),
};

export default apiClient;
