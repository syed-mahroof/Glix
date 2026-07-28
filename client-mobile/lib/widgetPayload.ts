// client-mobile/lib/widgetPayload.ts
// The single definition of what the home-screen widgets render.
//
// Two callers build this: store/watchStore.ts's syncWidgetData() (the normal
// path, right after a successful fetch/mutation) and the Android headless
// task handler (widgets/android/WidgetProvider.tsx), which rebuilds it from
// the persisted Zustand blob when SharedPreferences has no snapshot yet — a
// widget added before the app ever synced, or storage cleared underneath it.
// Both must agree exactly, hence one builder rather than two.

import { formatCountdown, todayLocalIso } from './dateFormat';
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
  countdown: string;
}

export interface WidgetPayload {
  watchlist: WidgetWatchlistItem[];
  upcoming: WidgetUpcomingItem[];
  loggedOut?: boolean;
  /** When the snapshot was built — lets a widget rendering hours later from
   *  a cached snapshot recompute its own day counts against the real today
   *  instead of trusting numbers frozen at sync time. */
  syncedAt: string;
}

/** How far ahead "AIRING SOON" looks, and the payload's item cap. Android's
 *  ListWidget genuinely scrolls through all of it; iOS shows as many as the
 *  widget family's fixed height allows (WidgetKit widgets can't scroll). */
const UPCOMING_WINDOW_DAYS = 14;
const UPCOMING_CAP = 30;
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
    .filter((item) => item.airDate >= todayIso && item.airDate <= windowEndIso)
    .slice(0, UPCOMING_CAP)
    .map((item) => {
      const { formatted, dayOfWeek } = formatCountdown(new Date(`${item.airDate}T00:00:00`), now);
      return {
        id: item.tmdbShowId,
        episode_id: item.episodeId,
        title: item.showTitle,
        poster_path: item.posterPath,
        next_episode: `S${item.seasonNumber} E${item.episodeNumber}`,
        air_date: item.airDate,
        countdown: `${formatted} (${dayOfWeek})`,
      };
    });

  return { watchlist, upcoming, syncedAt: now.toISOString() };
}
