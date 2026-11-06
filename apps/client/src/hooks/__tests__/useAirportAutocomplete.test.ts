/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';

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

import { AirportSuggestion, useAirportAutocomplete } from '../useAirportAutocomplete';

interface MockClient {
  get: jest.Mock;
}

const client = jest.requireMock<{ default: MockClient }>('../../utils/api-client').default;

const airport = (iata: string, city: string): AirportSuggestion => ({
  iata,
  name: `${city} Airport`,
  city,
  country: 'GB',
  latitude: 51.47,
  longitude: -0.45,
  label: `${city} (${iata})`,
  score: 1,
  matchedField: 'city',
});

const LHR = airport('LHR', 'London');
const LGW = airport('LGW', 'London Gatwick');

const ok = (suggestions: AirportSuggestion[]) => ({ data: { data: { suggestions } } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const signalOfCall = (index: number): AbortSignal => client.get.mock.calls[index][1].signal;

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  client.get.mockReset().mockResolvedValue(ok([LHR]));
  (console.error as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useAirportAutocomplete', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useAirportAutocomplete());
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('debounces the search and returns the suggestions', async () => {
    const { result } = renderHook(() => useAirportAutocomplete());

    act(() => result.current.search('  lon  '));
    expect(result.current.loading).toBe(true);

    await advance(299);
    expect(client.get).not.toHaveBeenCalled();

    await advance(1);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/api/airports/suggest', {
      params: { q: 'lon', limit: 8 },
      signal: expect.any(AbortSignal),
    });
    expect(result.current.suggestions).toEqual([LHR]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('only sends the last query when typing fast', async () => {
    const { result } = renderHook(() => useAirportAutocomplete());

    act(() => result.current.search('lo'));
    await advance(200);
    act(() => result.current.search('lon'));
    await advance(300);

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get.mock.calls[0][1].params.q).toBe('lon');
  });

  it('honours custom minChars and debounce', async () => {
    const { result } = renderHook(() => useAirportAutocomplete(3, 100));

    act(() => result.current.search('lo'));
    await advance(500);
    expect(client.get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    act(() => result.current.search('lon'));
    await advance(100);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(result.current.suggestions).toEqual([LHR]);
  });

  it('clears existing results when the query gets too short', async () => {
    const { result } = renderHook(() => useAirportAutocomplete());
    act(() => result.current.search('lon'));
    await advance(300);
    expect(result.current.suggestions).toEqual([LHR]);

    act(() => result.current.search(' l '));

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no data', {}],
    ['no inner data', { data: {} }],
    ['no suggestions', { data: { data: {} } }],
  ])('returns an empty list when the response has %s', async (_label, response) => {
    client.get.mockResolvedValue(response);
    const { result } = renderHook(() => useAirportAutocomplete());

    act(() => result.current.search('lon'));
    await advance(300);

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('sets an error and clears the suggestions when the request fails', async () => {
    const { result } = renderHook(() => useAirportAutocomplete());
    act(() => result.current.search('lon'));
    await advance(300);
    expect(result.current.suggestions).toEqual([LHR]);

    client.get.mockRejectedValue(new Error('Network Error'));
    act(() => result.current.search('lond'));
    await advance(300);

    expect(result.current.error).toBe('Failed to load airport suggestions');
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('clears a previous error on the next search', async () => {
    client.get.mockRejectedValueOnce(new Error('Network Error'));
    const { result } = renderHook(() => useAirportAutocomplete());
    act(() => result.current.search('lon'));
    await advance(300);
    expect(result.current.error).not.toBeNull();

    act(() => result.current.search('lond'));
    expect(result.current.error).toBeNull();
    await advance(300);
    expect(result.current.suggestions).toEqual([LHR]);
  });

  it.each(['CanceledError', 'AbortError'])('ignores a %s from the request', async (name) => {
    client.get.mockRejectedValue(Object.assign(new Error('canceled'), { name }));
    const { result } = renderHook(() => useAirportAutocomplete());

    act(() => result.current.search('lon'));
    await advance(300);

    expect(result.current.error).toBeNull();
    expect(result.current.suggestions).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('aborts the in-flight request on a new search and drops its late response', async () => {
    const first = deferred<ReturnType<typeof ok>>();
    client.get.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok([LGW]));
    const { result } = renderHook(() => useAirportAutocomplete());

    act(() => result.current.search('lon'));
    await advance(300);
    expect(signalOfCall(0).aborted).toBe(false);

    act(() => result.current.search('lond'));
    expect(signalOfCall(0).aborted).toBe(true);

    await act(async () => {
      first.resolve(ok([LHR]));
      await first.promise;
    });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(true);

    await advance(300);
    expect(result.current.suggestions).toEqual([LGW]);
    expect(result.current.loading).toBe(false);
  });

  it('clear() cancels a pending search', async () => {
    const { result } = renderHook(() => useAirportAutocomplete());

    act(() => result.current.search('lon'));
    act(() => result.current.clear());
    await advance(1000);

    expect(client.get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.suggestions).toEqual([]);
  });

  it('clear() aborts an in-flight request and resets state', async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    client.get.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useAirportAutocomplete());

    act(() => result.current.search('lon'));
    await advance(300);
    expect(result.current.loading).toBe(true);

    act(() => result.current.clear());
    expect(signalOfCall(0).aborted).toBe(true);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      pending.resolve(ok([LHR]));
      await pending.promise;
    });
    expect(result.current.suggestions).toEqual([]);
  });

  it('clear() with nothing pending just resets state', () => {
    const { result } = renderHook(() => useAirportAutocomplete());
    act(() => result.current.clear());
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('cancels a pending search on unmount', async () => {
    const { result, unmount } = renderHook(() => useAirportAutocomplete());
    act(() => result.current.search('lon'));
    unmount();
    await advance(1000);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request on unmount', async () => {
    client.get.mockReturnValueOnce(deferred<ReturnType<typeof ok>>().promise);
    const { result, unmount } = renderHook(() => useAirportAutocomplete());
    act(() => result.current.search('lon'));
    await advance(300);

    unmount();
    expect(signalOfCall(0).aborted).toBe(true);
  });

  it('unmounts cleanly when nothing was searched', () => {
    const { unmount } = renderHook(() => useAirportAutocomplete());
    expect(() => unmount()).not.toThrow();
  });
});
