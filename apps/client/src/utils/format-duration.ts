/** Formats a duration in minutes as "2h 30m". Returns `fallback` if it isn't a positive number. */
export function formatDuration(minutes: unknown, fallback = 'N/A'): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return fallback;
  }

  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
