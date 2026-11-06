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

import { useDeals } from '../useDeals';

interface MockClient {
  get: jest.Mock;
  post: jest.Mock;
}

const client = jest.requireMock<{ default: MockClient }>('../../utils/api-client').default;

const deal = {
  id: 'd1',
  type: 'flight',
  title: 'Cheap flight',
  description: 'SFO to JFK',
  originalPrice: 400,
  discountedPrice: 300,
  discountPercentage: 25,
  expiresAt: '2026-12-01T00:00:00Z',
};

const apiError = (message?: string) =>
  Object.assign(new Error('Request failed'), {
    response: { data: message ? { error: { message } } : {} },
  });

// Renders the hook and waits for the mount-time deals fetch to finish.
async function renderLoaded() {
  const hook = renderHook(() => useDeals());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: { data: { deals: [deal] } } });
  client.post.mockReset();
});

describe('useDeals: fetchDeals', () => {
  it('loads deals on mount', async () => {
    const { result } = renderHook(() => useDeals());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(client.get).toHaveBeenCalledWith('/api/concierge/deals');
    expect(result.current.deals).toEqual([deal]);
    expect(result.current.error).toBeNull();
  });

  it('falls back to an empty list when the response has no deals', async () => {
    client.get.mockResolvedValue({ data: {} });
    const { result } = await renderLoaded();
    expect(result.current.deals).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('exposes the server error message on failure', async () => {
    client.get.mockRejectedValue(apiError('Deals service down'));
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('Deals service down');
    expect(result.current.deals).toEqual([]);
  });

  it('uses a default message when the error has no server message', async () => {
    client.get.mockRejectedValue(new Error('Network Error'));
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('Failed to fetch deals');
  });

  it('refetches and clears a previous error', async () => {
    client.get.mockRejectedValueOnce(apiError('boom'));
    const { result } = await renderLoaded();
    expect(result.current.error).toBe('boom');

    await act(async () => {
      await result.current.fetchDeals();
    });

    expect(client.get).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.deals).toEqual([deal]);
  });
});

describe('useDeals: getBundles', () => {
  it('posts the preferences and returns the bundles', async () => {
    const bundles = [{ id: 'b1' }];
    client.post.mockResolvedValue({ data: { data: { bundles } } });
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.getBundles({ budget: 900 });
    });

    expect(client.post).toHaveBeenCalledWith('/api/concierge/bundles', { budget: 900 });
    expect(returned).toEqual(bundles);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns an empty list when the response has no bundles', async () => {
    client.post.mockResolvedValue({ data: {} });
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.getBundles({});
    });
    expect(returned).toEqual([]);
  });

  it('returns an empty list and sets the server error on failure', async () => {
    client.post.mockRejectedValue(apiError('No bundles'));
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.getBundles({});
    });
    expect(returned).toEqual([]);
    expect(result.current.error).toBe('No bundles');
    expect(result.current.loading).toBe(false);
  });

  it('uses a default message when the error has no server message', async () => {
    client.post.mockRejectedValue(new Error('Network Error'));
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.getBundles({});
    });
    expect(result.current.error).toBe('Failed to fetch bundles');
  });
});

describe('useDeals: createPriceWatch', () => {
  it('maps the watch fields to the concierge API and returns the watch', async () => {
    const watch = { id: 'w1' };
    client.post.mockResolvedValue({ data: { data: { watch } } });
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createPriceWatch({
        dealId: 'd1',
        userId: 'u1',
        alertPrice: 250,
        destination: 'JFK',
      });
    });

    expect(client.post).toHaveBeenCalledWith('/api/concierge/watch', {
      user_id: 'u1',
      destination: 'JFK',
      budget_ceiling: 250,
      min_fit_score: 60,
      notify_on_inventory_below: 5,
    });
    expect(returned).toEqual({ success: true, watch });
    expect(result.current.loading).toBe(false);
  });

  it('uses the deal id as destination and clamps the price to at least 1', async () => {
    client.post.mockResolvedValue({ data: {} });
    const { result } = await renderLoaded();

    let zeroResult: unknown;
    await act(async () => {
      zeroResult = await result.current.createPriceWatch({ dealId: 'd1', userId: 'u1', alertPrice: 0 });
    });
    await act(async () => {
      await result.current.createPriceWatch({ dealId: 'd2', userId: 'u1', alertPrice: -40 });
    });

    expect(client.post.mock.calls[0][1]).toMatchObject({ destination: 'd1', budget_ceiling: 1 });
    expect(client.post.mock.calls[1][1]).toMatchObject({ destination: 'd2', budget_ceiling: 1 });
    expect(zeroResult).toEqual({ success: true, watch: undefined });
  });

  it('returns the server error on failure', async () => {
    client.post.mockRejectedValue(apiError('Watch limit reached'));
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createPriceWatch({ dealId: 'd1', userId: 'u1', alertPrice: 100 });
    });
    expect(returned).toEqual({ success: false, error: 'Watch limit reached' });
    expect(result.current.error).toBe('Watch limit reached');
    expect(result.current.loading).toBe(false);
  });

  it('uses a default message when the error has no server message', async () => {
    client.post.mockRejectedValue(apiError());
    const { result } = await renderLoaded();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.createPriceWatch({ dealId: 'd1', userId: 'u1', alertPrice: 100 });
    });
    expect(returned).toEqual({ success: false, error: 'Failed to create watch' });
  });
});
