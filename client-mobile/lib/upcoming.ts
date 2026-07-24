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
  /** Real CachedEpisode tmdb_id for deep-linking straight to the episode
   *  (widget tap-through). Null for the synthetic `next_episode_to_air`
   *  item below — TMDB's next-episode summary has no locally cached
   *  episode row yet, so there's nothing to deep-link to but the show. */
  episodeId: number | null;
}

// Same 14-day recency window buildRows() (app/(tabs)/index.tsx) already uses
// to split a started-but-behind show into WATCH NEXT vs HAVEN'T WATCHED FOR A
// WHILE — reused here rather than a second, arbitrary threshold, so "counts
// as actively behind" means the same thing on both screens (Phase 54).
const OVERDUE_RECENCY_MS = 14 * 24 * 60 * 60 * 1000;

export function buildUpcomingItems(entries: WatchlistEntry[]): UpcomingItem[] {
  const todayIso = todayLocalIso();
  const nowMs = Date.now();
  const items: UpcomingItem[] = [];
  for (const entry of entries) {
    const show = entry.show;
    const seen = new Set<string>();

    // Aired-but-unwatched (Phase G, TV Time-style): previously any episode
    // whose air_date passed simply fell out of this list forever once
    // unwatched, even though the user never actually marked it — matching
    // the "next episode" definition pickNextEpisode() already uses (earliest
    // aired-unwatched), surface only that ONE episode per show as an
    // overdue item, not the entire unwatched backlog. Once it's marked
    // watched (or a later episode becomes the new "next"), it stops
    // qualifying here on the next recompute — it doesn't need to be tracked
    // as "dismissed" separately.
    //
    // Phase 54: this alone wasn't enough — every show in the watchlist with
    // ANY unwatched-and-aired episode qualified, no matter how stale, which
    // turned Upcoming into a full backlog dump for anyone with an imported
    // library. Two bounds now gate it: (1) a show the user has never started
    // (watched_episode_count === 0) never counts as "overdue" — that's what
    // the Shows Hub's own HAVEN'T STARTED pill is for, Upcoming shouldn't
    // become a second copy of it; (2) even a started show only counts as
    // genuinely "actively behind" if it was watched recently OR the missed
    // episode itself aired recently — a show untouched for months isn't
    // "behind," it's untouched backlog, same distinction buildRows() already
    // draws for its own pills.
    const overdue = show.episodes
      .filter((ep) => ep.air_date && ep.air_date < todayIso && !ep.is_watched)
      .sort((a, b) => {
        if (a.air_date! !== b.air_date!) return a.air_date! < b.air_date! ? -1 : 1;
        if (a.season_number !== b.season_number) return a.season_number - b.season_number;
        return a.episode_number - b.episode_number;
      })[0];
    if (overdue) {
      const hasStarted = entry.watched_episode_count > 0;
      const watchedRecently =
        !!entry.last_watched_at && nowMs - new Date(entry.last_watched_at).getTime() <= OVERDUE_RECENCY_MS;
      const airedRecently =
        nowMs - new Date(`${overdue.air_date}T00:00:00`).getTime() <= OVERDUE_RECENCY_MS;
      if (hasStarted && (watchedRecently || airedRecently)) {
        seen.add(`${overdue.season_number}-${overdue.episode_number}`);
        items.push({
          key: String(overdue.tmdb_id),
          showTitle: show.title,
          posterPath: show.poster_path,
          episodeTitle: overdue.title,
          seasonNumber: overdue.season_number,
          episodeNumber: overdue.episode_number,
          airDate: overdue.air_date!,
          tmdbShowId: show.tmdb_id,
          episodeId: overdue.tmdb_id,
        });
      }
    }

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
        episodeId: episode.tmdb_id,
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
        episodeId: null,
      });
    }
  }
  return items.sort((a, b) => a.airDate.localeCompare(b.airDate));
}

/** Discriminated union feeding the UPCOMING tab's List/Grid FlashList
 *  directly — a flat array of header + item entries rather than a nested
 *  sections structure, so both views can render it with one `data` prop. */
export type UpcomingListEntry =
  | { type: 'header'; key: string; label: string; count?: number }
  | { type: 'item'; key: string; data: UpcomingItem };

/**
 * Groups the flat, date-sorted Upcoming list into day-wise sections (see
 * formatUpcomingHeaderLabel for the exact bucketing rule) — user-requested:
 * "if an episode of a show and an episode of another show are releasing on
 * the same day, group them under that day." Since the bucket label itself
 * is the grouping key and items arrive pre-sorted by airDate, two shows
 * sharing an exact release date naturally land under the same header with
 * no extra bookkeeping.
 *
 * The OVERDUE header additionally carries a running `count` (Phase 54) so
 * the screen can render it as a collapsible "OVERDUE (N)" section instead of
 * a flat, unbounded block sitting ahead of every real future date — every
 * overdue item is guaranteed contiguous at the very front of the sorted
 * list (all have airDate < today), so a single running count is correct
 * without a second pass.
 */
export function groupUpcomingItemsByDate(items: UpcomingItem[], now: Date): UpcomingListEntry[] {
  const entries: UpcomingListEntry[] = [];
  let currentLabel: string | null = null;
  let currentHeader: Extract<UpcomingListEntry, { type: 'header' }> | null = null;

  for (const item of items) {
    const label = formatUpcomingHeaderLabel(item.airDate, now);
    if (label !== currentLabel) {
      currentHeader = { type: 'header', key: `header-${label}`, label };
      entries.push(currentHeader);
      currentLabel = label;
    }
    if (label === 'OVERDUE' && currentHeader) {
      currentHeader.count = (currentHeader.count ?? 0) + 1;
    }
    entries.push({ type: 'item', key: item.key, data: item });
  }
  return entries;
}
