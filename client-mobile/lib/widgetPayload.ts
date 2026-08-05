// client-mobile/lib/widgetPayload.ts
// The single definition of what the home-screen widgets render.
//
// Two callers build this: store/watchStore.ts's syncWidgetData() (the normal
// path, right after a successful fetch/mutation) and the Android headless
// task handler (widgets/android/WidgetProvider.tsx), which rebuilds it from
// the persisted Zustand blob when SharedPreferences has no snapshot yet — a
// widget added before the app ever synced, or storage cleared underneath it.
// Both must agree exactly, hence one builder rather than two.

import { resolveDisplayDateIso, todayLocalIso } from './dateFormat';
import { buildUpcomingItems, pickNextEpisode } from './upcoming';
import type { WatchlistEntry } from '../store/watchStore';

export interface WidgetWatchlistItem {
  id: number;
  episode_id: number | null;
  title: string;
  poster_path: string | null;
  next_episode: string;
}

export interface WidgetUpcomingItem {
  id: number;
  episode_id: number | null;
  title: string;
  poster_path: string | null;
  next_episode: string;
  air_date: string;
  /** Exact UTC instant, from CachedEpisode.air_datetime /
   *  CachedShow.next_episode_air_datetime — the most precise source the
   *  widget can resolve from. Preferred over airs_time/airs_timezone below
   *  when present; see lib/dateFormat.ts's resolveAirInstant. Absent for
   *  episodes TVmaze hasn't matched yet, and on snapshots written by an app
   *  build older than this field. */
  air_datetime?: string | null;
  /** The show's broadcast slot — wall clock ("21:30") plus its IANA zone
   *  ("America/New_York"), from TVmaze via the backend. Deliberately raw
   *  rather than a precomputed "9:30 PM" string: see the note on
   *  `syncedAt` below for why the widget resolves these itself. Absent
   *  for shows with no fixed slot, and on snapshots written by an app
   *  build older than this field — both render as no time line. */
  airs_time?: string | null;
  airs_timezone?: string | null;
  /** Carried through from Show.air_time_source (see UpcomingItem.airTimeSource
   *  in lib/upcoming.ts) — which tier resolved airs_time/airs_timezone
   *  above. Both widget renderers combine this with air_datetime to derive
   *  isEstimated for their formatLocalAirTime call, so a platform-estimate
   *  time is shown with a "~" instead of identically to a confirmed one. */
  air_time_source?: 'tvmaze_exact' | 'tvmaze_slot' | 'platform_estimate' | '' | null;
}

export interface WidgetPayload {
  watchlist: WidgetWatchlistItem[];
  upcoming: WidgetUpcomingItem[];
  loggedOut?: boolean;
  /** When the snapshot was built.
   *
   *  Nothing time-relative is ever precomputed into this payload — not the
   *  day badge, not the countdown, not the air time. A home-screen widget
   *  redraws on its own schedule (Android's updatePeriodMillis, iOS's
   *  WidgetKit timeline) long after the app was last open, and frequently
   *  while the app is not running at all, so any duration baked in at sync
   *  time is wrong by however long ago that sync happened — a countdown
   *  written on Monday still reading "2d" on Wednesday. The widgets
   *  recompute from `air_date`/`airs_time` against the real clock at
   *  render, which costs nothing and is correct from a snapshot of any
   *  age. This field is kept for diagnostics and staleness checks only. */
  syncedAt: string;
}

/** How far ahead "AIRING SOON" looks, and the payload's item cap. Android's
 *  ListWidget genuinely scrolls through all of it (widgets/android/
 *  UpcomingWidget.tsx renders the full capped list into the native
 *  RemoteViews collection, not a further-truncated slice); iOS shows as many
 *  as the widget family's fixed height allows (WidgetKit widgets can't
 *  scroll). Widened from the original 14 days / 30 items — with several
 *  tracked shows airing weekly, 14 days routinely ran out of content after
 *  one or two rows. Both stay well under Android's per-widget RemoteViews
 *  transaction size limit even at the cap. */
const UPCOMING_WINDOW_DAYS = 45;
const UPCOMING_CAP = 50;
const WATCHLIST_CAP = 8;

/**
 * @param nextUpEntries shows with something left to watch — the "NEXT UP" widget.
 * @param allEntries every tracked show, including caught-up ones, since a show
 *   the user is current on is exactly the one whose next episode they're
 *   waiting for — that's the "AIRING SOON" widget's source.
 */
export function buildWidgetPayload(
  nextUpEntries: WatchlistEntry[],
  allEntries: WatchlistEntry[] = nextUpEntries,
  now: Date = new Date()
): WidgetPayload {
  // "Next up" per show — same chronological rule the Shows Hub row uses
  // (earliest aired-unwatched, else nearest future episode), not just "first
  // unwatched in array order". episode_id deep-links straight to the episode.
  const watchlist: WidgetWatchlistItem[] = nextUpEntries.slice(0, WATCHLIST_CAP).map((entry) => {
    const nextEp = pickNextEpisode(entry);
    return {
      id: entry.show.tmdb_id,
      episode_id: nextEp?.tmdb_id ?? null,
      title: entry.show.title,
      poster_path: entry.show.poster_path,
      next_episode: nextEp ? `S${nextEp.season_number} E${nextEp.episode_number}` : 'Up to date',
    };
  });

  // Strictly-future only. buildUpcomingItems() also emits recently-missed
  // episodes for the in-app tab's collapsible catch-up sections; the widget
  // has nowhere to put those, so the todayIso lower bound keeps them out.
  const todayIso = todayLocalIso(now);
  const windowEndIso = todayLocalIso(new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 86400000));
  const upcoming: WidgetUpcomingItem[] = buildUpcomingItems(allEntries)
    .filter((item) => {
      // Resolved display date, not the raw airDate string — an item whose
      // true air instant crosses local midnight relative to its show's own
      // timezone must be judged "future" or "in window" against the day it
      // actually lands on for this viewer, not TMDB's bare date.
      const displayDateIso = resolveDisplayDateIso(item.airDate, item.airDateTime, item.airsTime, item.airsTimezone);
      return displayDateIso >= todayIso && displayDateIso <= windowEndIso;
    })
    .slice(0, UPCOMING_CAP)
    .map((item) => {
      return {
        id: item.tmdbShowId,
        episode_id: item.episodeId,
        title: item.showTitle,
        poster_path: item.posterPath,
        next_episode: `S${item.seasonNumber} E${item.episodeNumber}`,
        air_date: item.airDate,
        air_datetime: item.airDateTime,
        airs_time: item.airsTime,
        airs_timezone: item.airsTimezone,
        air_time_source: item.airTimeSource,
      };
    });

  return { watchlist, upcoming, syncedAt: now.toISOString() };
}
