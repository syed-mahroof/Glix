import { formatCountdown, buildMonthGrid } from '../lib/dateFormat';

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
