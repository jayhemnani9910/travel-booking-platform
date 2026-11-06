import { formatDuration } from '../format-duration';

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(150)).toBe('2h 30m');
    expect(formatDuration(101)).toBe('1h 41m');
  });

  it('omits zero parts', () => {
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(45)).toBe('45m');
  });

  it('rounds fractional minutes', () => {
    expect(formatDuration(59.6)).toBe('1h');
  });

  it('returns the fallback for missing or invalid values', () => {
    expect(formatDuration(undefined)).toBe('N/A');
    expect(formatDuration(null)).toBe('N/A');
    expect(formatDuration(0)).toBe('N/A');
    expect(formatDuration(-10)).toBe('N/A');
    expect(formatDuration(Number.NaN)).toBe('N/A');
    expect(formatDuration('150')).toBe('N/A');
    expect(formatDuration(undefined, '')).toBe('');
  });
});
