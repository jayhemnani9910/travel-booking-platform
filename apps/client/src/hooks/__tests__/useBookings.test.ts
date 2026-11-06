/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';

// Stub the shared axios instance (the network edge); services/api runs for real on top of it.
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

import { useBookings } from '../useBookings';

interface MockClient {
  get: jest.Mock;
  post: jest.Mock;
}

const client = jest.requireMock<{ default: MockClient }>('../../utils/api-client').default;

const booking = (id: string) => ({
  id,
  userId: 'u1',
  type: 'flight',
  status: 'confirmed',
  totalAmount: 320,
  createdAt: '2026-11-01T10:00:00Z',
  items: [],
});

const apiError = (message?: string) =>
  Object.assign(new Error('Request failed'), {
    response: { data: message ? { error: { message } } : {} },
  });

// Renders the hook for a user and waits for the mount-time fetch to finish.
async function renderLoaded(userId: string | undefined = 'u1') {
  const hook = renderHook(() => useBookings(userId));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: { data: [booking('b1')] } });
  client.post.mockReset();
});

describe('useBookings: fetchBookings', () => {
  it('does not fetch without a user id', async () => {
    const { result } = renderHook(() => useBookings());

    await act(async () => {
      await result.current.fetchBookings();
    });

    expect(client.get).not.toHaveBeenCalled();
    expect(result.current.bookings).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('loads the user bookings on mount', async () => {
    const { result } = renderHook(() => useBookings('u1'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(client.get).toHaveBeenCalledWith('/api/bookings/user/u1');
    expect(result.current.bookings).toEqual([booking('b1')]);
    expect(result.current.error).toBeNull();
  });

  it('accepts a payload wrapped in { bookings }', async () => {
    client.get.mockResolvedValue({ data: { data: { bookings: [booking('b2')] } } });
    const { result } = await renderLoaded();
    expect(result.current.bookings).toEqual([booking('b2')]);
  });

  it.each([
    ['an object without bookings', {}],
    ['a null payload', null],
  ])('falls back to an empty list for %s', async (_label, payload) => {
    client.get.mockResolvedValue({ data: { data: payload } });
    const { result } = await renderLoaded();
    expect(result.current.bookings).toEqual([]);
  });

  it('exposes the server error message on failure', async () => {
    client.get.mockRejectedValue(apiError('User not found'));
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('User not found');
    expect(result.current.bookings).toEqual([]);
  });

  it('uses a default message when the error has no server message', async () => {
    client.get.mockRejectedValue(new Error('Network Error'));
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('Failed to fetch bookings');
  });

  it('refetches when the user id changes', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useBookings(id), {
      initialProps: { id: 'u1' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    client.get.mockResolvedValue({ data: { data: [booking('b9')] } });
    rerender({ id: 'u2' });

    await waitFor(() => expect(result.current.bookings).toEqual([booking('b9')]));
    expect(client.get).toHaveBeenLastCalledWith('/api/bookings/user/u2');
  });
});

describe('useBookings: createBooking', () => {
  it('posts the booking, prepends it to the list and reports success', async () => {
    const created = booking('b-new');
    client.post.mockResolvedValue({ data: { data: created } });
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createBooking({ type: 'flight' });
    });

    expect(client.post).toHaveBeenCalledWith(
      '/api/bookings',
      { type: 'flight' },
      { headers: { 'X-Idempotency-Key': expect.stringMatching(/^booking_/) } }
    );
    expect(returned).toEqual({ success: true, booking: created });
    expect(result.current.bookings.map((b) => b.id)).toEqual(['b-new', 'b1']);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('reports the server error on failure and keeps the list', async () => {
    client.post.mockRejectedValue(apiError('Seat no longer available'));
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createBooking({});
    });

    expect(returned).toEqual({ success: false, error: 'Seat no longer available' });
    expect(result.current.error).toBe('Seat no longer available');
    expect(result.current.bookings).toEqual([booking('b1')]);
    expect(result.current.loading).toBe(false);
  });

  it('uses a default message when the error has no server message', async () => {
    client.post.mockRejectedValue(apiError());
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createBooking({});
    });
    expect(returned).toEqual({ success: false, error: 'Booking failed' });
  });
});

describe('useBookings: getBooking', () => {
  it('returns the booking', async () => {
    client.get.mockImplementation((url: string) =>
      Promise.resolve({ data: { data: url === '/api/bookings/b7' ? booking('b7') : [] } })
    );
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.getBooking('b7');
    });

    expect(client.get).toHaveBeenCalledWith('/api/bookings/b7');
    expect(returned).toEqual(booking('b7'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns null and sets the server error on failure', async () => {
    const { result } = await renderLoaded();
    client.get.mockRejectedValue(apiError('Booking not found'));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.getBooking('missing');
    });
    expect(returned).toBeNull();
    expect(result.current.error).toBe('Booking not found');
    expect(result.current.loading).toBe(false);
  });

  it('uses a default message when the error has no server message', async () => {
    const { result } = await renderLoaded();
    client.get.mockRejectedValue(new Error('Network Error'));

    await act(async () => {
      await result.current.getBooking('b1');
    });
    expect(result.current.error).toBe('Failed to fetch booking');
  });
});
