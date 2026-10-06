/**
 * Calendar days as the client reads them: in UK time, so a 20:00 kickoff in
 * late October and one in July both fall on the day they were played.
 */
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The UK date of a moment, as YYYY-MM-DD. */
export function londonDay(d: Date): string {
  return fmt.format(d);
}

/** Minutes the UK is ahead of UTC at a moment (0 or 60). */
function offsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  let diff = h * 60 + m - (at.getUTCHours() * 60 + at.getUTCMinutes());
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

/** The first moment of a UK day, from YYYY-MM-DD; null if malformed. */
export function londonDayStart(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // UK midnight is UTC midnight or the hour before it. The clocks change at
  // 01:00 UTC, never in that hour, so the offset a minute before UTC midnight
  // is the one in force at UK midnight.
  const off = offsetMinutes(new Date(utcMidnight - 60_000));
  return new Date(utcMidnight - off * 60_000);
}

/** [start, end) of a UK day. */
export function londonDayBounds(ymd: string): { start: Date; end: Date } | null {
  const start = londonDayStart(ymd);
  if (!start) return null;
  const next = new Date(start.getTime() + 36 * 3_600_000); // safely inside tomorrow
  const end = londonDayStart(londonDay(next))!;
  return { start, end };
}
