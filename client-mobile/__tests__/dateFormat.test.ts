import {
  formatCountdown,
  buildMonthGrid,
  airDateTimeInstant,
  formatLocalAirTime,
  formatUpcomingHeaderLabel,
  formatWeekdayShort,
  resolveAirInstant,
  resolveDisplayDateIso,
  shouldAppendWeekday,
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

  // A3/A4 — the platform-estimate tier (core/airtime_platforms.py) rides the
  // same airs_time/airs_timezone pair as a confirmed TVmaze slot, so it must
  // resolve to the identical instant; only the displayed string should
  // differ, by a leading "~" that marks it as a guess rather than a fact.
  describe('isEstimated "~" prefix', () => {
    it('prefixes "~" when isEstimated is true and a time resolves', () => {
      const instant = airDateTimeInstant('2026-01-15', '21:00', 'America/New_York')!;
      const expected = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(instant);
      expect(formatLocalAirTime('2026-01-15', null, '21:00', 'America/New_York', true)).toBe(`~${expected}`);
    });

    it('does not prefix "~" when isEstimated is false', () => {
      const instant = airDateTimeInstant('2026-01-15', '21:00', 'America/New_York')!;
      const expected = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(instant);
      expect(formatLocalAirTime('2026-01-15', null, '21:00', 'America/New_York', false)).toBe(expected);
    });

    it('does not prefix "~" when isEstimated is omitted (existing call sites unaffected)', () => {
      const instant = airDateTimeInstant('2026-01-15', '21:00', 'America/New_York')!;
      const expected = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(instant);
      expect(formatLocalAirTime('2026-01-15', null, '21:00', 'America/New_York')).toBe(expected);
    });

    it('stays null when isEstimated is true but no time resolves at all', () => {
      // A "true" estimate flag can't manufacture a time out of nothing — the
      // "~" only ever wraps an actually-resolved instant.
      expect(formatLocalAirTime('2026-01-15', null, null, null, true)).toBeNull();
    });
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

// A5 — widget day-of-week labels. shouldAppendWeekday must say "yes" only
// for the two formatUpcomingHeaderLabel branches that don't already spell
// out a weekday (the absolute-date branch and 'LATER'), and "no" for every
// other branch, so a widget row never repeats (or contradicts) what its own
// header already says.
describe('shouldAppendWeekday', () => {
  // Fixed reference "now" so every offset below lands on a deterministic
  // diffDays bucket regardless of when the test suite actually runs.
  const now = new Date('2026-01-01T00:00:00');

  it('is true for LATER', () => {
    expect(shouldAppendWeekday('LATER')).toBe(true);
  });

  it('is true for a real formatUpcomingHeaderLabel absolute-date output', () => {
    // 10 days out falls in the 7-30 day "absolute date" branch, e.g. "JAN 11, 2026".
    const label = formatUpcomingHeaderLabel('2026-01-11', now);
    expect(label).toMatch(/^[A-Z]{3} \d{1,2}, \d{4}$/);
    expect(shouldAppendWeekday(label)).toBe(true);
  });

  it('is false for TODAY', () => {
    expect(shouldAppendWeekday(formatUpcomingHeaderLabel('2026-01-01', now))).toBe(false);
    expect(shouldAppendWeekday('TODAY')).toBe(false);
  });

  it('is false for TOMORROW', () => {
    expect(shouldAppendWeekday(formatUpcomingHeaderLabel('2026-01-02', now))).toBe(false);
    expect(shouldAppendWeekday('TOMORROW')).toBe(false);
  });

  it('is false for a weekday-name label (2-6 days out)', () => {
    // 3 days out falls in the 2-6 day "weekday name" branch, e.g. "TUESDAY".
    const label = formatUpcomingHeaderLabel('2026-01-04', now);
    expect(label).not.toBe('LATER');
    expect(label).not.toMatch(/^[A-Z]{3} \d{1,2}, \d{4}$/);
    expect(shouldAppendWeekday(label)).toBe(false);
    expect(shouldAppendWeekday('TUESDAY')).toBe(false);
  });

  it('is false for each past-window label', () => {
    expect(shouldAppendWeekday(formatUpcomingHeaderLabel('2025-12-27', now))).toBe(false); // LAST WEEK
    expect(shouldAppendWeekday(formatUpcomingHeaderLabel('2025-12-10', now))).toBe(false); // LAST MONTH
    expect(shouldAppendWeekday(formatUpcomingHeaderLabel('2025-01-01', now))).toBe(false); // EARLIER
    expect(shouldAppendWeekday('LAST WEEK')).toBe(false);
    expect(shouldAppendWeekday('LAST MONTH')).toBe(false);
    expect(shouldAppendWeekday('EARLIER')).toBe(false);
  });
});

describe('formatWeekdayShort', () => {
  it('formats a display-date ISO as a short weekday name', () => {
    // 2026-01-14 is a Wednesday.
    expect(formatWeekdayShort('2026-01-14')).toBe('Wed');
  });
});
