// client-mobile/lib/dateFormat.ts

/**
 * Pads a number to two digits (e.g., 5 -> "05").
 */
export function pad(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0');
}

/**
 * Today's calendar date in the device's LOCAL timezone, as YYYY-MM-DD.
 * `Date#toISOString()` converts to UTC first, which silently shifts the
 * returned date by a day for any positive UTC offset during early-morning
 * local hours (or negative offset during late-evening hours) — e.g. a user
 * in IST (UTC+5:30) at 2:00 AM local already has toISOString() reporting
 * yesterday's date. Every other date computation in this file (and the
 * callers that compare air dates against "today") anchors on local midnight
 * via `new Date(\`${iso}T00:00:00\`)`, so "today" must be computed the same
 * local-anchored way to stay consistent and avoid off-by-one-day bugs.
 */
export function todayLocalIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Formats the time remaining until a target date.
 * Returns the formatted string (e.g., "3d 05h 12m" or "05:12:30")
 * and a boolean indicating if it's imminent (within 24 hours).
 */
export function formatCountdown(
  targetDate: Date,
  now: Date
): { formatted: string; isImminent: boolean; dayOfWeek: string } {
  const IMMINENT_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  const diffMs = targetDate.getTime() - now.getTime();
  const isImminent = diffMs >= 0 && diffMs <= IMMINENT_THRESHOLD_MS;

  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const formatted =
    days > 0
      ? `${days}d ${pad(hours)}h ${pad(minutes)}m`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      
  const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(targetDate);

  return { formatted, isImminent, dayOfWeek };
}

/**
 * Buckets a single upcoming episode's air date into the day-wise header
 * label used by the Shows Hub's UPCOMING tab (List + Grid views): TODAY /
 * TOMORROW, a weekday name for the next few days, an absolute date for
 * anything up to a month out (so two different shows releasing on the same
 * calendar date land under one shared header), then a single "LATER"
 * catch-all beyond that — day-level grouping stops being useful that far
 * ahead, so those items keep their own relative countdown instead.
 */
export function formatUpcomingHeaderLabel(airDate: string, now: Date): string {
  const todayIso = todayLocalIso(now);
  if (airDate === todayIso) return 'TODAY';

  // Same local-midnight construction UpcomingRow already uses for its own
  // countdown target, so the two stay consistent with each other.
  const target = new Date(`${airDate}T00:00:00`);
  const todayMidnight = new Date(`${todayIso}T00:00:00`);
  const diffDays = Math.round((target.getTime() - todayMidnight.getTime()) / 86400000);

  if (diffDays === 1) return 'TOMORROW';
  if (diffDays >= 2 && diffDays <= 6) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(target).toUpperCase();
  }
  if (diffDays >= 7 && diffDays <= 30) {
    return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(target)
      .toUpperCase();
  }
  return 'LATER';
}

/**
 * Builds a 2D array of Dates representing a month grid.
 * Each inner array is a week (7 days, starting on Sunday).
 * Includes leading/trailing days from adjacent months to fill the grid.
 */
export function buildMonthGrid(year: number, month: number): Date[][] {
  const firstDayOfMonth = new Date(year, month, 1);
  const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday, 6 = Saturday

  // Back up to the previous Sunday
  const startDate = new Date(year, month, 1 - startDayOfWeek);

  const grid: Date[][] = [];
  let currentDate = new Date(startDate);

  // Usually a month spans 5 or 6 weeks. We'll generate 6 weeks to be safe and consistent.
  for (let week = 0; week < 6; week++) {
    const weekRow: Date[] = [];
    for (let day = 0; day < 7; day++) {
      weekRow.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    grid.push(weekRow);
  }

  return grid;
}
