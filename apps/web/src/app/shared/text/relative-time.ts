const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3_600_000],
  ['month', 30 * 24 * 3_600_000],
  ['week', 7 * 24 * 3_600_000],
  ['day', 24 * 3_600_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "just now", "5 minutes ago", "yesterday"… for a moment in the past (or near future). */
export function timeAgo(iso: string, now: Date, locale = 'en'): string {
  const elapsed = now.getTime() - Date.parse(iso);
  if (Number.isNaN(elapsed)) {
    return '';
  }
  if (Math.abs(elapsed) < 60_000) {
    return 'just now';
  }
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) {
      return format.format(-Math.round(elapsed / size), unit);
    }
  }
  return format.format(-Math.round(elapsed / 60_000), 'minute');
}
