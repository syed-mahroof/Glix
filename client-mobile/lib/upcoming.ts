// client-mobile/lib/upcoming.ts
// Shared "upcoming episode" item shape + builder, used by the Shows Hub's
// Upcoming tab (List + Calendar views).

import { formatUpcomingHeaderLabel, todayLocalIso } from './dateFormat';
import type { Episode, WatchlistEntry } from '../store/watchStore';

/** Same "next episode" rule the Shows Hub row uses: earliest aired-unwatched,
 *  falling back to the nearest future episode, falling back to the last episode
 *  once everything is watched. Shared so the widget data bridge stays truthful
 *  to what the Shows Hub itself would show as "next up" for a given entry. */
export function pickNextEpisode(entry: WatchlistEntry): Episode | null {
  const todayIso = todayLocalIso();
  const airedUnwatched = entry.show.episodes.filter(
    (ep) => ep.air_date && ep.air_date <= todayIso && !ep.is_watched
  );
  if (airedUnwatched.length > 0) return airedUnwatched[0];
  const future = entry.show.episodes.filter(
    (ep) => ep.air_date && ep.air_date > todayIso && !ep.is_watched
  );
  if (future.length > 0) return future[0];
  if (entry.show.episodes.length > 0)
    return entry.show.episodes[entry.show.episodes.length - 1];
  return null;
}

export interface UpcomingItem {
  key: string;
  showTitle: string;
  posterPath: string | null;
  episodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  airDate: string;
  tmdbShowId: number;
}

export function buildUpcomingItems(entries: WatchlistEntry[]): UpcomingItem[] {
  const todayIso = todayLocalIso();
  const items: UpcomingItem[] = [];
  for (const entry of entries) {
    const show = entry.show;
    const seen = new Set<string>();
    for (const episode of show.episodes) {
      if (!episode.air_date || episode.air_date < todayIso || episode.is_watched) continue;
      seen.add(`${episode.season_number}-${episode.episode_number}`);
      items.push({
        key: String(episode.tmdb_id),
        showTitle: show.title,
        posterPath: show.poster_path,
        episodeTitle: episode.title,
        seasonNumber: episode.season_number,
        episodeNumber: episode.episode_number,
        airDate: episode.air_date,
        tmdbShowId: show.tmdb_id,
      });
    }
    // TMDB's next_episode_to_air (see Show.next_episode_*) surfaces a real
    // premiere date for a watchlisted show even when that season hasn't
    // been cached locally at all yet — e.g. a freshly-announced new season
    // with only a premiere date confirmed. Without this, a show sitting in
    // "Haven't Started" (or any bucket) with a brand-new season on the way
    // would silently never appear here, since `show.episodes` only ever
    // holds seasons get_season_episodes() has actually fetched.
    const key = `${show.next_episode_season_number}-${show.next_episode_number}`;
    if (
      show.next_episode_air_date &&
      show.next_episode_air_date >= todayIso &&
      show.next_episode_season_number != null &&
      show.next_episode_number != null &&
      !seen.has(key)
    ) {
      items.push({
        key: `next-${show.tmdb_id}`,
        showTitle: show.title,
        posterPath: show.poster_path,
        episodeTitle: show.next_episode_name || 'TBA',
        seasonNumber: show.next_episode_season_number,
        episodeNumber: show.next_episode_number,
        airDate: show.next_episode_air_date,
        tmdbShowId: show.tmdb_id,
      });
    }
  }
  return items.sort((a, b) => a.airDate.localeCompare(b.airDate));
}

/** Discriminated union feeding the UPCOMING tab's List/Grid FlashList
 *  directly — a flat array of header + item entries rather than a nested
 *  sections structure, so both views can render it with one `data` prop. */
export type UpcomingListEntry =
  | { type: 'header'; key: string; label: string }
  | { type: 'item'; key: string; data: UpcomingItem };

/**
 * Groups the flat, date-sorted Upcoming list into day-wise sections (see
 * formatUpcomingHeaderLabel for the exact bucketing rule) — user-requested:
 * "if an episode of a show and an episode of another show are releasing on
 * the same day, group them under that day." Since the bucket label itself
 * is the grouping key and items arrive pre-sorted by airDate, two shows
 * sharing an exact release date naturally land under the same header with
 * no extra bookkeeping.
 */
export function groupUpcomingItemsByDate(items: UpcomingItem[], now: Date): UpcomingListEntry[] {
  const entries: UpcomingListEntry[] = [];
  let currentLabel: string | null = null;

  for (const item of items) {
    const label = formatUpcomingHeaderLabel(item.airDate, now);
    if (label !== currentLabel) {
      entries.push({ type: 'header', key: `header-${label}`, label });
      currentLabel = label;
    }
    entries.push({ type: 'item', key: item.key, data: item });
  }
  return entries;
}
