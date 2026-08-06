// client-mobile/lib/dateFormat.ts

/**
 * Pads a number to two digits (e.g., 5 -> "05").
 */
export function pad(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0');
}

// Perf fix (2026-08-07): constructing an Intl.DateTimeFormat crosses into
// native ICU — on Hermes/Android specifically, a JNI call into android.icu —
// and is one of the most expensive routine operations available to JS.
// resolveAirInstant() (below) builds two of these per call via
// zoneOffsetMs(), and it's called once per episode by buildUpcomingItems and
// once per visible row per countdown tick, so an unmemoized watchlist of a
// few hundred shows could mean tens of thousands of formatter constructions
// in a single render pass. Every formatter with fixed options is built once
// here, at module load; the one call site with a variable option
// (zoneOffsetMs's `timeZone`) is cached per zone the first time it's seen
// and reused for the rest of the app's lifetime — there are only a couple
// dozen IANA zones in practice (TVmaze network slots), not per-episode.
const WEEKDAY_LONG_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const HEADER_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const LOCAL_AIR_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const WEEKDAY_SHORT_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

const zoneOffsetFormatters = new Map<string, Intl.DateTimeFormat>();
function getZoneOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneOffsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneOffsetFormatters.set(timeZone, formatter);
  }
  return formatter;
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
 * Whether a TMDB air_date/release_date (YYYY-MM-DD, or null/undefined for
 * a not-yet-dated episode/movie) is on or before today, local time. Shared
 * home for the `x.air_date && x.air_date <= todayLocalIso()` comparison
 * that used to be hand-inlined at 9+ call sites — a null/undefined date
 * counts as "not aired yet" (TMDB hasn't dated it), never as "aired".
 */
export function hasAired(dateIso: string | null | undefined, now: Date = new Date()): boolean {
  return !!dateIso && dateIso <= todayLocalIso(now);
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
      
  const dayOfWeek = WEEKDAY_LONG_FORMATTER.format(targetDate);

  return { formatted, isImminent, dayOfWeek };
}

/**
 * Compact "day count" badge for the Upcoming widgets' right-aligned release
 * marker (Phase 55; countdown text removed in Phase 75.1 — a widget can't
 * tick live, so a static countdown was always stale the moment it rendered
 * and often wrong by up to a day besides). This badge plus
 * formatLocalAirTime's clock time are the whole release-time line now.
 * Widget items are always strictly future by the time this is called
 * (syncWidgetData filters Overdue out before building the payload), but this
 * stays safe for a same-day item too. Callers should pass a display-date ISO
 * from resolveDisplayDateIso, not a raw TMDB air_date, so this never
 * disagrees with the resolved air instant across a local-midnight boundary.
 */
export function formatDayBadge(airDate: string, now: Date): string {
  const todayIso = todayLocalIso(now);
  if (airDate === todayIso) return 'TODAY';

  const target = new Date(`${airDate}T00:00:00`);
  const todayMidnight = new Date(`${todayIso}T00:00:00`);
  const diffDays = Math.round((target.getTime() - todayMidnight.getTime()) / 86400000);
  return `${diffDays}D`;
}

/**
 * How many milliseconds `timeZone` is ahead of UTC at a given instant.
 *
 * JS can format an instant *into* an IANA zone but has no built-in way to
 * go the other way (wall clock in a zone -> instant), which is exactly what
 * an air time needs: TVmaze gives "21:30" plus "America/New_York", and the
 * correct offset for that depends on the episode's own date because of DST.
 * Formatting the instant in the target zone and re-reading the fields back
 * as if they were UTC recovers the offset for that specific moment.
 *
 * `hour12: false` can legitimately yield hour "24" for midnight on some
 * engines, hence the `% 24`.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = getZoneOffsetFormatter(timeZone).formatToParts(instant);

  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') field[part.type] = Number(part.value);
  }
  const asIfUtc = Date.UTC(
    field.year,
    field.month - 1,
    field.day,
    field.hour % 24,
    field.minute,
    field.second
  );
  return asIfUtc - instant.getTime();
}

/**
 * The exact instant an episode airs, from its air date plus the show's
 * network slot — `airsTime` ("21:30") interpreted in `airsTimezone`
 * ("America/New_York"), both from TVmaze via the backend (CachedShow,
 * core/airtime.py). Returns null whenever the show has no known slot,
 * which is the common case for streaming originals; callers fall back to
 * date-only behaviour rather than inventing a time.
 *
 * Two passes: the first offset lookup uses the wall clock read as UTC
 * (off by up to a day's worth of offset), the second re-reads the offset
 * at the corrected instant. That converges everywhere except inside a
 * DST fold, where either answer is defensible for a broadcast slot.
 */
export function airDateTimeInstant(
  airDate: string,
  airsTime: string | null | undefined,
  airsTimezone: string | null | undefined
): Date | null {
  if (!airsTime || !airsTimezone) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(airsTime);
  if (!match) return null;

  const [year, month, day] = airDate.split('-').map(Number);
  if (!year || !month || !day) return null;

  try {
    const wallClockAsUtc = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
    const firstPass = new Date(wallClockAsUtc - zoneOffsetMs(new Date(wallClockAsUtc), airsTimezone));
    const instant = new Date(wallClockAsUtc - zoneOffsetMs(firstPass, airsTimezone));
    return Number.isNaN(instant.getTime()) ? null : instant;
  } catch {
    // A zone name the engine's ICU data doesn't carry. Showing no time is
    // strictly better than showing a time that's silently in the wrong zone.
    return null;
  }
}

/** The known air instant for an episode, or null if nothing more precise
 *  than a bare calendar date is available. Shared by resolveAirInstant()
 *  (which falls back further, to local midnight) and formatLocalAirTime()
 *  (which must NOT fall back — no known time means no time line at all). */
function resolveKnownAirInstant(
  airDate: string,
  airDateTime: string | null | undefined,
  airsTime: string | null | undefined,
  airsTimezone: string | null | undefined
): Date | null {
  if (airDateTime) {
    const exact = new Date(airDateTime);
    if (!Number.isNaN(exact.getTime())) return exact;
  }
  return airDateTimeInstant(airDate, airsTime, airsTimezone);
}

/**
 * The best-known instant an episode airs, in resolution order:
 * 1. `airDateTime` — an exact instant from TVmaze's per-episode `airstamp`
 *    (backend: CachedEpisode.air_datetime / CachedShow.next_episode_air_datetime).
 * 2. `airsTime` + `airsTimezone` — the show's network broadcast slot.
 * 3. Local midnight of `airDate` — the only fallback when neither source is
 *    known. A countdown built off this undercounts by up to a day, but it's
 *    the same thing every call site used to do unconditionally, so this is
 *    never a regression — only ever an improvement when 1 or 2 apply.
 *
 * Every countdown / grouping / badge call site should route through this
 * (or resolveDisplayDateIso below) so "what time does this air" and "what
 * calendar day does this display under" can never disagree with each other.
 */
export function resolveAirInstant(
  airDate: string,
  airDateTime?: string | null,
  airsTime?: string | null,
  airsTimezone?: string | null
): Date {
  return (
    resolveKnownAirInstant(airDate, airDateTime, airsTime, airsTimezone) ??
    new Date(`${airDate}T00:00:00`)
  );
}

/**
 * The local calendar date (YYYY-MM-DD) an item should be bucketed/labeled
 * under, derived from its resolved air instant rather than the raw TMDB
 * `air_date` string. The two disagree whenever the resolved instant crosses
 * local midnight relative to the show's own timezone — e.g. a 9:00 PM
 * America/New_York episode airing "2026-08-03" is already 2026-08-04 for an
 * IST viewer, so bucketing off the raw string put it a day early for them.
 */
export function resolveDisplayDateIso(
  airDate: string,
  airDateTime?: string | null,
  airsTime?: string | null,
  airsTimezone?: string | null
): string {
  return todayLocalIso(resolveAirInstant(airDate, airDateTime, airsTime, airsTimezone));
}

/**
 * The device-local clock time an episode airs — "9:30 PM" — or null when
 * neither an exact instant nor a broadcast slot is known. This is the piece
 * TMDB simply cannot provide (its episode payload is a bare `air_date` with
 * no time), which is why the countdown it fed always ran to local midnight
 * and so always ended in "00m".
 *
 * `isEstimated` marks a time that rode in on the same airs_time/
 * airs_timezone pair as a real broadcast slot, but was actually filled by
 * the backend's platform-estimate fallback (CachedShow.air_time_source ===
 * "platform_estimate", core/airtime.py) rather than a confirmed TVmaze
 * value — a well-documented streaming-platform convention (e.g. "Netflix
 * drops at midnight Pacific"), not a fact about this specific episode.
 * Prefixing "~" is the whole of the distinction: resolveKnownAirInstant/
 * resolveAirInstant/resolveDisplayDateIso deliberately do NOT change
 * behavior for an estimate, since ordering and day-bucketing off a
 * reasonable estimate is still correct — only the displayed string needs
 * to own up to being a guess, per this module's founding principle that
 * showing no time beats showing a wrong (or, here, unmarked-uncertain) one.
 */
export function formatLocalAirTime(
  airDate: string,
  airDateTime: string | null | undefined,
  airsTime: string | null | undefined,
  airsTimezone: string | null | undefined,
  isEstimated?: boolean
): string | null {
  const instant = resolveKnownAirInstant(airDate, airDateTime, airsTime, airsTimezone);
  if (!instant) return null;
  try {
    const formatted = LOCAL_AIR_TIME_FORMATTER.format(instant);
    return isEstimated ? `~${formatted}` : formatted;
  } catch {
    return null;
  }
}

/** "3 DAYS AGO" / "YESTERDAY" for an already-aired, unmarked episode — more
 *  useful than a flat "OVERDUE" label now that these are bounded to recent
 *  releases and the user's question is "how far behind am I?". Pass a
 *  display-date ISO from resolveDisplayDateIso, not a raw TMDB air_date. */
export function formatDaysAgo(airDate: string, now: Date): string {
  const target = new Date(`${airDate}T00:00:00`);
  const todayMidnight = new Date(`${todayLocalIso(now)}T00:00:00`);
  const diffDays = Math.round((todayMidnight.getTime() - target.getTime()) / 86400000);
  if (diffDays <= 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  return `${diffDays} DAYS AGO`;
}

/** How far back a missed-but-aired episode can be and still count as a
 *  "recent release you haven't marked" rather than plain backlog. Shared by
 *  the Upcoming tab's past-bucket labels and buildUpcomingItems()'s own gate
 *  so the two can never disagree about what qualifies. */
export const PAST_WINDOW_DAYS = 30;

/** True for the past-air-date buckets, which the Upcoming tab renders as
 *  collapsible sections (every future bucket is a plain, static label). */
export function isPastUpcomingLabel(label: string): boolean {
  return label === 'LAST WEEK' || label === 'LAST MONTH' || label === 'EARLIER';
}

/**
 * Buckets a single upcoming episode's air date into the day-wise header
 * label used by the Shows Hub's UPCOMING tab (List + Grid views): TODAY /
 * TOMORROW, a weekday name for the next few days, an absolute date for
 * anything up to a month out (so two different shows releasing on the same
 * calendar date land under one shared header), then a single "LATER"
 * catch-all beyond that — day-level grouping stops being useful that far
 * ahead, so those items keep their own relative countdown instead.
 *
 * Pass a display-date ISO from resolveDisplayDateIso, not a raw TMDB
 * air_date — otherwise an episode whose resolved air instant crosses local
 * midnight buckets under the wrong day for a viewer in a different zone.
 */
export function formatUpcomingHeaderLabel(airDate: string, now: Date): string {
  const todayIso = todayLocalIso(now);
  if (airDate === todayIso) return 'TODAY';

  // Same local-midnight construction UpcomingRow already uses for its own
  // countdown target, so the two stay consistent with each other.
  const target = new Date(`${airDate}T00:00:00`);
  const todayMidnight = new Date(`${todayIso}T00:00:00`);
  const diffDays = Math.round((target.getTime() - todayMidnight.getTime()) / 86400000);

  // Aired-but-unwatched items stay in this list past their air date instead of
  // disappearing. They're bucketed by how recently they aired so the section
  // reads as "recent releases you missed", not an unbounded past-due dump —
  // buildUpcomingItems() never emits anything older than PAST_WINDOW_DAYS.
  if (diffDays < 0) {
    if (diffDays >= -7) return 'LAST WEEK';
    if (diffDays >= -PAST_WINDOW_DAYS) return 'LAST MONTH';
    return 'EARLIER';
  }
  if (diffDays === 1) return 'TOMORROW';
  if (diffDays >= 2 && diffDays <= 6) {
    return WEEKDAY_LONG_FORMATTER.format(target).toUpperCase();
  }
  if (diffDays >= 7 && diffDays <= 30) {
    return HEADER_DATE_FORMATTER.format(target).toUpperCase();
  }
  return 'LATER';
}

/**
 * True for the two formatUpcomingHeaderLabel outputs that do NOT already
 * name a weekday — the absolute-date branch ("AUG 12, 2026") and the
 * 'LATER' catch-all. A row grouped under one of those benefits from a
 * "(Wed)" suffix on its own subtitle line since the header above it
 * doesn't say which day of the week it is; a row under 'TODAY' / 'TOMORROW'
 * / a weekday-name header ('TUESDAY') / a past-window label would just be
 * repeating (or contradicting the point of) what the header already says.
 *
 * The regex matches formatUpcomingHeaderLabel's `{ day: 'numeric', month:
 * 'short', year: 'numeric' }` branch after `.toUpperCase()` — verified
 * against real `Intl` output (e.g. "AUG 12, 2026" / "AUG 5, 2026"), not
 * assumed.
 */
export function shouldAppendWeekday(headerLabel: string): boolean {
  return headerLabel === 'LATER' || /^[A-Z]{3} \d{1,2}, \d{4}$/.test(headerLabel);
}

/** "Wed" for a display-date ISO — the short weekday name to append (in
 *  parentheses, by the caller) next to a row's episode info when
 *  shouldAppendWeekday says its header doesn't already convey that.
 *  Pass a display-date ISO from resolveDisplayDateIso, not a raw TMDB
 *  air_date, for the same cross-midnight reasons as every other date
 *  helper in this file. */
export function formatWeekdayShort(displayDateIso: string): string {
  const target = new Date(`${displayDateIso}T00:00:00`);
  return WEEKDAY_SHORT_FORMATTER.format(target);
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
