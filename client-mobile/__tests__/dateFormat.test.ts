import { formatCountdown, buildMonthGrid, airDateTimeInstant, formatLocalAirTime } from '../lib/dateFormat';

describe('dateFormat', () => {
  it('formats countdown correctly', () => {
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + 5);
    const result = formatCountdown(futureDate, today);
    expect(result.formatted).toContain('5d');
  });

  it('builds a valid month grid', () => {
    const grid = buildMonthGrid(2026, 6); // July 2026
    expect(grid.length).toBe(6); // 6 weeks
    expect(grid[0].length).toBe(7); // 7 days per week
  });
});

// Phase 73: TVmaze-sourced air time (TMDB itself has no clock time at all,
// only a bare air_date — see the widgets' old countdown always ending in
// "00m"). airDateTimeInstant resolves a wall-clock time + IANA zone pair
// into the actual instant, DST included, which is the part worth testing —
// a wrong offset here would silently show every US show an hour early or
// late for half the year.
describe('airDateTimeInstant / formatLocalAirTime', () => {
  it('resolves a standard-time broadcast slot to the correct UTC instant', () => {
    // 9:00 PM US Eastern in January is UTC-5 (standard time, no DST) -> 02:00 UTC next day.
    const instant = airDateTimeInstant('2026-01-15', '21:00', 'America/New_York');
    expect(instant).not.toBeNull();
    expect(instant!.toISOString()).toBe('2026-01-16T02:00:00.000Z');
  });

  it('resolves a daylight-saving broadcast slot to a different UTC offset than winter', () => {
    // Same 9:00 PM Eastern slot in July is UTC-4 (daylight time) -> 01:00 UTC,
    // one hour earlier in UTC than the January case above despite the same
    // local wall-clock time. A DST-naive implementation (fixed offset) would
    // get one of these two cases wrong.
    const summerInstant = airDateTimeInstant('2026-07-15', '21:00', 'America/New_York');
    expect(summerInstant).not.toBeNull();
    expect(summerInstant!.toISOString()).toBe('2026-07-16T01:00:00.000Z');
  });

  it('returns null when the show has no known broadcast slot', () => {
    expect(airDateTimeInstant('2026-01-15', null, null)).toBeNull();
    expect(airDateTimeInstant('2026-01-15', '21:00', null)).toBeNull();
    expect(airDateTimeInstant('2026-01-15', null, 'America/New_York')).toBeNull();
  });

  it('formatLocalAirTime renders the resolved instant in the device-local zone, null when unknown', () => {
    // Deliberately not asserting a literal "9:00 PM" here: formatLocalAirTime's
    // whole point is converting the network's slot into whatever timezone the
    // test runner (or a real device) is in, so the expected string is itself
    // environment-dependent. Assert it against the same instant
    // airDateTimeInstant resolves, formatted the same way the function does,
    // rather than hardcoding a US-Eastern-specific clock reading that would
    // only pass in that one timezone.
    const instant = airDateTimeInstant('2026-01-15', '21:00', 'America/New_York')!;
    const expected = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(instant);
    expect(formatLocalAirTime('2026-01-15', '21:00', 'America/New_York')).toBe(expected);
    expect(formatLocalAirTime('2026-01-15', null, null)).toBeNull();
  });
});
