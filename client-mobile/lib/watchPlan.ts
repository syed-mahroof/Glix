import type { Episode } from '../store/watchStore';

export interface SeriesWorkload {
  episodes: number;
  minutes: number;
  averageRuntime: number;
  estimatedEpisodes: number;
}

export function seriesWorkload(episodes: Episode[], totalEpisodes: number, watchedCount: number, wholeSeries = false, fallbackRuntime = 45): SeriesWorkload {
  let runtimeSum = 0;
  let runtimeCount = 0;
  const unique = new Map<number, Episode>();
  for (const episode of episodes) unique.set(episode.tmdb_id, episode);
  for (const episode of unique.values()) {
    if (Number.isFinite(episode.runtime_minutes) && episode.runtime_minutes > 0) {
      runtimeSum += episode.runtime_minutes;
      runtimeCount += 1;
    }
  }
  const averageRuntime = runtimeCount ? Math.max(1, Math.round(runtimeSum / runtimeCount)) : Number.isFinite(fallbackRuntime) && fallbackRuntime > 0 ? fallbackRuntime : 45;
  const count = Math.max(0, Math.max(totalEpisodes, unique.size) - (wholeSeries ? 0 : watchedCount));
  let knownMinutes = 0;
  let knownCount = 0;
  let eligibleCount = 0;
  for (const episode of unique.values()) {
    if (!wholeSeries && episode.is_watched) continue;
    eligibleCount += 1;
    if (Number.isFinite(episode.runtime_minutes) && episode.runtime_minutes > 0) {
      knownMinutes += episode.runtime_minutes;
      knownCount += 1;
    }
  }
  const episodeCount = Math.max(count, eligibleCount);
  const estimatedEpisodes = Math.max(0, episodeCount - knownCount);
  return { episodes: episodeCount, minutes: knownMinutes + estimatedEpisodes * averageRuntime, averageRuntime, estimatedEpisodes };
}

export function planSeries(work: SeriesWorkload, minutesPerDay: number, weekdaysOnly: boolean, today = new Date()) {
  if (!Number.isFinite(minutesPerDay) || minutesPerDay < 1 || minutesPerDay > 1440) return null;
  const watchDays = Math.ceil(work.minutes / minutesPerDay);
  const finish = new Date(today);
  finish.setHours(0, 0, 0, 0);
  if (watchDays > 0) {
    if (weekdaysOnly) {
      if (finish.getDay() === 0) finish.setDate(finish.getDate() + 1);
      if (finish.getDay() === 6) finish.setDate(finish.getDate() + 2);
      const weekday = (finish.getDay() + 6) % 7;
      const offset = watchDays - 1;
      finish.setDate(finish.getDate() + offset + 2 * Math.floor((weekday + offset) / 5));
    } else finish.setDate(finish.getDate() + watchDays - 1);
  }
  return { watchDays, finish, episodesPerDay: work.averageRuntime > 0 ? minutesPerDay / work.averageRuntime : 0 };
}

export function formatWatchMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${remainder}m`;
}
