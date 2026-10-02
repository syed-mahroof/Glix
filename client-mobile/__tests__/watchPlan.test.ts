import { formatWatchMinutes, planSeries, seriesWorkload } from '../lib/watchPlan';
import type { Episode } from '../store/watchStore';

const episode = (id: number, runtime: number, watched = false): Episode => ({
  tmdb_id: id, season_number: 1, episode_number: id, title: 'Episode',
  air_date: '2020-01-01', runtime_minutes: runtime, is_watched: watched,
});

it('uses exact runtimes and estimates only missing episodes, without double counting', () => {
  const episodes = [episode(1, 40, true), episode(2, 60), episode(2, 60), episode(3, 0)];
  expect(seriesWorkload(episodes, 5, 1)).toEqual({ episodes: 4, minutes: 210, averageRuntime: 50, estimatedEpisodes: 3 });
  expect(seriesWorkload(episodes, 5, 1, true).minutes).toBe(250);
});

it('handles missing metadata, completed shows, and invalid daily budgets', () => {
  expect(seriesWorkload([], 3, 0).minutes).toBe(135);
  const completed = seriesWorkload([episode(1, 40, true)], 1, 1);
  expect(planSeries(completed, 60, false)?.watchDays).toBe(0);
  for (const budget of [0, -1, 1441, NaN, Infinity]) expect(planSeries(completed, budget, false)).toBeNull();
});

it('includes the first watch session and crosses weekends correctly', () => {
  const work = { episodes: 5, minutes: 300, averageRuntime: 60, estimatedEpisodes: 0 };
  const friday = new Date(2026, 9, 2);
  expect(planSeries(work, 60, false, friday)?.finish.getDate()).toBe(6);
  expect(planSeries(work, 60, true, friday)?.finish.getDate()).toBe(8);
  const saturday = new Date(2026, 9, 3);
  expect(planSeries(work, 60, true, saturday)?.finish.getDate()).toBe(9);
  expect(formatWatchMinutes(135)).toBe('2h 15m');
});
