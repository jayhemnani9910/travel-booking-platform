import apiClient from '../utils/api-client';

// Re-use the shared apiClient which already handles baseURL, auth tokens and interceptors.
const api = apiClient;

// Add trace id header on top of the shared client
api.interceptors.request.use((config) => {
  if (!config.headers) config.headers = {} as any;
  config.headers['X-Trace-Id'] = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  return config;
});

// User API
export const userApi = {
  getUser: (id: string) => api.get(`/api/users/${id}`),
  createUser: (data: any) => api.post('/api/users', data),
  updateUser: (id: string, data: any) => api.put(`/api/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/api/users/${id}`),
  searchUsers: (params: any) => api.get('/api/users', { params }),
};

// Auth API
export const authApi = {
  login: (email: string, password: string) => api.post('/api/auth/login', { email, password }),
  register: (data: any) => api.post('/api/auth/register', data),
  refresh: () => api.post('/api/auth/refresh'),
  logout: () => api.post('/api/auth/logout'),
};

// Flights API
export const flightsApi = {
  searchFlights: (data: any) => api.get('/api/flights/search', { params: data }),
  getFlight: (id: string) => api.get(`/api/flights/${id}`),
  getFlightsByRoute: (origin: string, destination: string, params?: any) => 
    api.get(`/api/flights/route/${origin}/${destination}`, { params }),
};

// Hotels API
export const hotelsApi = {
  searchHotels: (data: any) => api.get('/api/hotels/search', { params: data }),
  getHotel: (id: string) => api.get(`/api/hotels/${id}`),
};

// Cars API
export const carsApi = {
  searchCars: (data: any) => api.get('/api/cars/search', { params: data }),
  getCar: (id: string) => api.get(`/api/cars/${id}`),
};

// Booking API
export const bookingApi = {
  createBooking: (data: any) => api.post('/api/bookings', data, {
    headers: {
      'X-Idempotency-Key': `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }
  }),
  getBooking: (id: string) => api.get(`/api/bookings/${id}`),
  getUserBookings: (userId: string) => api.get(`/api/bookings/user/${userId}`),
  cancelBooking: (id: string) => api.put(`/api/bookings/${id}/cancel`),
  updateBooking: (id: string, data: any) => api.put(`/api/bookings/${id}`, data),
};

// Billing API
export const billingApi = {
  createPaymentIntent: (data: any) => api.post('/api/billing/create-payment-intent', data),
  getPayment: (id: string) => api.get(`/api/billing/payment/${id}`),
};

// Concierge API
export const conciergeApi = {
  getBundles: (data: any) => api.post('/api/concierge/bundles', data),
  getDeals: () => api.get('/api/concierge/deals'),
  createWatch: (data: any) => api.post('/api/concierge/watch', data),
  chat: (message: string) => api.post('/api/concierge/chat', { message }),
};

// Admin API
export const adminApi = {
  getStats: () => api.get('/api/admin/stats'),
  getUsers: (params: any) => api.get('/api/admin/users', { params }),
  getBookings: (params: any) => api.get('/api/admin/bookings', { params }),
  createListing: (data: any) => api.post('/api/admin/listings', data),
};

// Airport API
export const airportsApi = {
  suggest: (query: string, limit?: number, signal?: AbortSignal) =>
    api.get('/api/airports/suggest', { params: { q: query, limit }, signal }),
  resolve: (query: string) => api.get('/api/airports/resolve', { params: { q: query } }),
  getAirport: (code: string) => api.get(`/api/airports/${code}`),
  getNearby: (code: string) => api.get(`/api/airports/${code}/nearby`),
};

// Health check
export const healthApi = {
  check: () => api.get('/health'),
};

export default api;
