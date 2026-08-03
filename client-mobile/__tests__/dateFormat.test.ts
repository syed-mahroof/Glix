import {
  formatCountdown,
  buildMonthGrid,
  airDateTimeInstant,
  formatLocalAirTime,
  resolveAirInstant,
  resolveDisplayDateIso,
} from '../lib/dateFormat';

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
    expect(formatLocalAirTime('2026-01-15', null, '21:00', 'America/New_York')).toBe(expected);
    expect(formatLocalAirTime('2026-01-15', null, null, null)).toBeNull();
  });

  it('formatLocalAirTime prefers an exact airDateTime over the broadcast slot', () => {
    const exact = '2026-01-15T13:00:00.000Z';
    const expected = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
      new Date(exact)
    );
    // Slot says 9 PM Eastern; airDateTime says 13:00 UTC — the exact instant wins.
    expect(formatLocalAirTime('2026-01-15', exact, '21:00', 'America/New_York')).toBe(expected);
  });
});

// Phase 75.1: the three-tier resolution order (exact airstamp -> broadcast
// slot -> local midnight) that every countdown/grouping call site routes
// through now, plus the cross-midnight local-date bug this phase fixed —
// an episode's true air instant can land on a different calendar day than
// its raw TMDB air_date once resolved into the viewer's own timezone.
describe('resolveAirInstant / resolveDisplayDateIso', () => {
  it('prefers airDateTime when present', () => {
    const exact = '2026-01-16T02:00:00.000Z';
    const instant = resolveAirInstant('2026-01-15', exact, '09:00', 'America/New_York');
    expect(instant.toISOString()).toBe(exact);
  });

  it('falls back to the broadcast slot when airDateTime is absent', () => {
    const instant = resolveAirInstant('2026-01-15', null, '21:00', 'America/New_York');
    expect(instant.toISOString()).toBe('2026-01-16T02:00:00.000Z');
  });

  it('falls back to local midnight when neither an exact instant nor a slot is known', () => {
    const instant = resolveAirInstant('2026-01-15', null, null, null);
    expect(instant.toISOString()).toBe(new Date('2026-01-15T00:00:00').toISOString());
  });

  it('resolveDisplayDateIso can land on a different calendar day than the raw air_date', () => {
    // 9:00 PM America/New_York on Jan 15 is 02:00 the next day in UTC, and
    // later still (a full calendar day ahead) for an IST viewer testing
    // against the exact instant — the bug was bucketing this under "15"
    // for every viewer regardless of their own timezone.
    const exact = '2026-01-16T02:00:00.000Z'; // 9 PM Eastern on the 15th, in UTC
    const displayDate = resolveDisplayDateIso('2026-01-15', exact, null, null);
    // The display date is whatever the exact UTC instant falls on in the
    // *device's* local zone — assert it against the same instant rather
    // than hardcoding a zone-specific expectation.
    const expected = new Date(exact);
    const expectedIso = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
    expect(displayDate).toBe(expectedIso);
  });
});
