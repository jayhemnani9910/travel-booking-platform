import { ErrorCodes, generateTraceId } from '../common';

describe('contracts/common', () => {
  it('maps every error code to its own name', () => {
    expect(Object.values(ErrorCodes)).toEqual([
      'VALIDATION_ERROR',
      'NOT_FOUND',
      'CONFLICT',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'RATE_LIMITED',
      'IDEMPOTENCY_CONFLICT'
    ]);
    for (const [key, value] of Object.entries(ErrorCodes)) {
      expect(value).toBe(key);
    }
  });

  describe('generateTraceId', () => {
    it('ends with the current time in base 36', () => {
      const now = 1700000000000;
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const id = generateTraceId();
        expect(id).toMatch(/^[a-z0-9]+$/);
        expect(id.endsWith(now.toString(36))).toBe(true);
        expect(id.length).toBeGreaterThan(now.toString(36).length);
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('produces different ids on successive calls', () => {
      const ids = new Set(Array.from({ length: 50 }, () => generateTraceId()));
      expect(ids.size).toBe(50);
    });
  });
});
