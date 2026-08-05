// client-mobile/lib/upcoming.ts
// Shared "upcoming episode" item shape + builder, used by the Shows Hub's
// Upcoming tab (List + Calendar views).

import {
  PAST_WINDOW_DAYS,
  formatUpcomingHeaderLabel,
  isPastUpcomingLabel,
  resolveAirInstant,
  resolveDisplayDateIso,
  todayLocalIso,
} from './dateFormat';
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
  /** Exact UTC instant, from CachedEpisode.air_datetime (or
   *  Show.next_episode_air_datetime for the synthetic item below) — the
   *  most precise source resolveAirInstant() can use. Null until a
   *  background sync has matched TVmaze's per-episode airstamp for it. */
  airDateTime: string | null;
  tmdbShowId: number;
  /** Real CachedEpisode tmdb_id for deep-linking straight to the episode
   *  (widget tap-through). Null for the synthetic `next_episode_to_air`
   *  item below — TMDB's next-episode summary has no locally cached
   *  episode row yet, so there's nothing to deep-link to but the show. */
  episodeId: number | null;
  /** The show's broadcast slot, carried through from Show.airs_time /
   *  Show.airs_timezone so a consumer can render a real local air time
   *  without needing the whole Show object. Wall clock + IANA zone, not a
   *  device-local time — see formatLocalAirTime. */
  airsTime: string | null;
  airsTimezone: string | null;
  /** Carried through from Show.air_time_source (backend: CachedShow,
   *  core/airtime.py) — which tier resolved airsTime/airsTimezone above.
   *  'platform_estimate' means the pair is a well-known streaming-platform
   *  convention (e.g. "Netflix drops at midnight Pacific"), not a
   *  confirmed TVmaze value; consumers combine this with airDateTime to
   *  decide whether to mark a rendered time with formatLocalAirTime's "~"
   *  — see the isEstimated computation at both widget renderers. */
  airTimeSource?: 'tvmaze_exact' | 'tvmaze_slot' | 'platform_estimate' | '' | null;
}

const PAST_WINDOW_MS = PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function buildUpcomingItems(entries: WatchlistEntry[]): UpcomingItem[] {
  const todayIso = todayLocalIso();
  const nowMs = Date.now();
  const items: UpcomingItem[] = [];
  for (const entry of entries) {
    const show = entry.show;
    const seen = new Set<string>();

    // Missed-but-recently-aired: the Upcoming tab is for what's coming and
    // what just came out — a show's whole unwatched backlog belongs to the
    // Watch List tab's own buckets, not here. So the only past-dated item a
    // show can contribute is its earliest unwatched episode that aired
    // *within the last PAST_WINDOW_DAYS* — an episode from years ago is
    // backlog, not a missed release, no matter how recently the user last
    // touched the show. Filtering by window before picking the earliest (not
    // after) is what keeps a long-behind show's genuinely-recent episode
    // visible instead of being represented by an ancient one that then gets
    // discarded. Once marked watched it stops qualifying on the next
    // recompute — nothing needs to track it as "dismissed".
    const missed = show.episodes
      .filter(
        (ep) =>
          ep.air_date &&
          ep.air_date < todayIso &&
          !ep.is_watched &&
          nowMs -
            resolveAirInstant(ep.air_date, ep.air_datetime, show.airs_time, show.airs_timezone).getTime() <=
            PAST_WINDOW_MS
      )
      .sort((a, b) => {
        if (a.air_date! !== b.air_date!) return a.air_date! < b.air_date! ? -1 : 1;
        if (a.season_number !== b.season_number) return a.season_number - b.season_number;
        return a.episode_number - b.episode_number;
      })[0];
    if (missed) {
      seen.add(`${missed.season_number}-${missed.episode_number}`);
      items.push({
        key: String(missed.tmdb_id),
        showTitle: show.title,
        posterPath: show.poster_path,
        episodeTitle: missed.title,
        seasonNumber: missed.season_number,
        episodeNumber: missed.episode_number,
        airDate: missed.air_date!,
        airDateTime: missed.air_datetime ?? null,
        tmdbShowId: show.tmdb_id,
        episodeId: missed.tmdb_id,
        airsTime: show.airs_time ?? null,
        airsTimezone: show.airs_timezone ?? null,
        airTimeSource: show.air_time_source,
      });
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
        airDateTime: episode.air_datetime ?? null,
        tmdbShowId: show.tmdb_id,
        episodeId: episode.tmdb_id,
        airsTime: show.airs_time ?? null,
        airsTimezone: show.airs_timezone ?? null,
        airTimeSource: show.air_time_source,
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
        airDateTime: show.next_episode_air_datetime ?? null,
        tmdbShowId: show.tmdb_id,
        episodeId: null,
        airsTime: show.airs_time ?? null,
        airsTimezone: show.airs_timezone ?? null,
        airTimeSource: show.air_time_source,
      });
    }
  }
  // Sorted by resolved air instant rather than the raw airDate string, so an
  // exact airDateTime (or a broadcast slot) can correctly order two items
  // that share a calendar date but not a time — the raw string alone can't.
  return items.sort(
    (a, b) =>
      resolveAirInstant(a.airDate, a.airDateTime, a.airsTime, a.airsTimezone).getTime() -
      resolveAirInstant(b.airDate, b.airDateTime, b.airsTime, b.airsTimezone).getTime()
  );
}

/** Discriminated union feeding the UPCOMING tab's List/Grid FlashList
 *  directly — a flat array of header + item entries rather than a nested
 *  sections structure, so both views can render it with one `data` prop. */
export type UpcomingListEntry =
  | { type: 'header'; key: string; label: string; count: number; collapsible: boolean }
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
 * Every header carries a running `count`; the past-dated ones (LAST WEEK /
 * LAST MONTH) are additionally marked `collapsible` so the screen can render
 * them as tap-to-expand sections that default closed, keeping a catch-up
 * list from sitting ahead of and swallowing the real TODAY/TOMORROW sections.
 * Items arrive sorted by airDate, so each bucket's items are contiguous and
 * one running counter per header is correct without a second pass.
 */
export function groupUpcomingItemsByDate(items: UpcomingItem[], now: Date): UpcomingListEntry[] {
  const entries: UpcomingListEntry[] = [];
  let currentLabel: string | null = null;
  let currentHeader: Extract<UpcomingListEntry, { type: 'header' }> | null = null;

  for (const item of items) {
    const displayDateIso = resolveDisplayDateIso(item.airDate, item.airDateTime, item.airsTime, item.airsTimezone);
    const label = formatUpcomingHeaderLabel(displayDateIso, now);
    if (label !== currentLabel || !currentHeader) {
      currentHeader = {
        type: 'header',
        key: `header-${label}`,
        label,
        count: 0,
        collapsible: isPastUpcomingLabel(label),
      };
      entries.push(currentHeader);
      currentLabel = label;
    }
    currentHeader.count += 1;
    entries.push({ type: 'item', key: item.key, data: item });
  }
  return entries;
}
