// client-mobile/__tests__/upcoming.test.ts
//
// Regression coverage for the "Watch List shows a different weekday than
// Upcoming for the same episode" fix (Phase 85, Batch A/E). pickNextEpisode
// used to compare the raw TMDB air_date string directly against today's
// local date — the same class of bug as the Watch List badge mislabeling,
// just here it could pick the WRONG episode as "next" rather than just
// mislabeling the right one.

import { buildUpcomingItems, pickNextEpisode } from '../lib/upcoming';
import { buildWidgetPayload } from '../lib/widgetPayload';
import type { Episode, Show, WatchlistEntry } from '../store/watchStore';

function makeEpisode(overrides: Partial<Episode>): Episode {
  return {
    tmdb_id: 1,
    show: 100,
    season_number: 1,
    episode_number: 1,
    title: 'Episode',
    air_date: null,
    air_datetime: null,
    runtime_minutes: 30,
    is_watched: false,
    ...overrides,
  };
}

function makeEntry(episodes: Episode[], showOverrides: Partial<Show> = {}): WatchlistEntry {
  const show: Show = {
    tmdb_id: 100,
    title: 'Test Show',
    overview: '',
    poster_path: null,
    backdrop_path: null,
    first_air_date: null,
    status: 'RETURNING',
    vote_average: 0,
    total_seasons: 1,
    total_episodes: episodes.length,
    original_language: 'en',
    genres: [],
    next_episode_air_date: null,
    next_episode_season_number: null,
    next_episode_number: null,
    next_episode_name: null,
    episodes,
    ...showOverrides,
  };
  return {
    id: 1,
    show,
    status: 'TO_WATCH',
    is_favorite: false,
    ignore_catchup: false,
    watched_episode_count: 0,
    aired_episode_count: episodes.length,
    progress_percentage: 0,
    last_watched_at: null,
    active_rewatch: null,
    seasons_cached: 1,
    added_at: '',
    updated_at: '',
  };
}

describe('pickNextEpisode', () => {
  it('never offers the watched finale even when season coverage or counts are stale', () => {
    const entry = makeEntry([makeEpisode({ is_watched: true })], { total_seasons: 2, total_episodes: 8 });
    expect(pickNextEpisode(entry)).toBeNull();
    expect(buildWidgetPayload([entry]).watchlist).toEqual([]);
  });

  it('keeps an unwatched undated episode and genuinely missing-data shows visible', () => {
    const entry = makeEntry([makeEpisode({ air_date: null })]);
    expect(pickNextEpisode(entry)?.tmdb_id).toBe(1);
    expect(buildWidgetPayload([makeEntry([])]).watchlist).toHaveLength(1);
  });
  it('resolves the real air instant instead of trusting the raw air_date string — the actual bug fixed', () => {
    // Both episodes carry the SAME long-past raw air_date. Under the old
    // (buggy) comparison, both would qualify as "aired and unwatched",
    // and array order alone would decide the winner — ep_trap is placed
    // FIRST specifically so a regression back to the old behavior would
    // return it instead of ep_old.
    const tenDaysFromNow = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    const epTrap = makeEpisode({
      tmdb_id: 1,
      episode_number: 1,
      air_date: '2020-01-01', // raw string says "long aired"
      air_datetime: tenDaysFromNow, // real instant: 10 days in the future — never aired yet in any real timezone
    });
    const epOld = makeEpisode({
      tmdb_id: 2,
      episode_number: 2,
      air_date: '2020-01-01', // genuinely long aired, no air_datetime override needed
    });

    const entry = makeEntry([epTrap, epOld]);
    const next = pickNextEpisode(entry);

    // The fixed code must resolve epTrap's real air instant (10 days out)
    // and exclude it from "aired", leaving epOld as the only qualifying
    // episode — regardless of array order.
    expect(next?.tmdb_id).toBe(epOld.tmdb_id);
  });

  it('falls back to the first future-unwatched episode (in season/episode order) once nothing aired-unwatched remains', () => {
    // pickNextEpisode takes the first array match, not a date sort — this
    // relies on the backend already ordering episodes by
    // (season_number, episode_number), same as the real serializer does.
    // Two genuinely-future dates (both resolved via resolveDisplayDateIso,
    // not raw comparison) confirm neither is misclassified as "aired".
    const tenDaysFromNow = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const twentyDaysFromNow = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const epSooner = makeEpisode({ tmdb_id: 1, episode_number: 1, air_date: tenDaysFromNow });
    const epLater = makeEpisode({ tmdb_id: 2, episode_number: 2, air_date: twentyDaysFromNow });

    const entry = makeEntry([epSooner, epLater]);
    const next = pickNextEpisode(entry);
    expect(next?.tmdb_id).toBe(epSooner.tmdb_id);
  });

  it('returns null for a show with no episodes at all', () => {
    expect(pickNextEpisode(makeEntry([]))).toBeNull();
  });
});

describe('upcoming consistency', () => {
  const now = new Date(2026, 9, 3, 12);
  const summary: Partial<Show> = {
    next_episode_air_date: '2026-10-03', next_episode_season_number: 1, next_episode_number: 1,
  };

  it('never resurrects a watched episode through a stale next-episode summary', () => {
    const entry = makeEntry([makeEpisode({ air_date: '2026-10-03', is_watched: true })], summary);
    expect(buildUpcomingItems([entry], now)).toEqual([]);
  });

  it('keeps uncached premieres while excluding archived and duplicate shows', () => {
    const entry = makeEntry([], summary);
    expect(buildUpcomingItems([entry, entry], now)).toHaveLength(1);
    expect(buildUpcomingItems([{ ...entry, status: 'ARCHIVED' }], now)).toEqual([]);
  });

  it('uses the resolved instant for recent releases rather than an obsolete raw date', () => {
    const entry = makeEntry([makeEpisode({ air_date: '2020-01-01', air_datetime: '2026-10-04T12:00:00Z' })]);
    expect(buildUpcomingItems([entry], now)[0].episodeId).toBe(1);
  });

  it('keeps only the earliest recently missed episode per show, excluding old backlog', () => {
    const entry = makeEntry([
      makeEpisode({ tmdb_id: 1, air_date: '2020-01-01' }),
      makeEpisode({ tmdb_id: 2, episode_number: 2, air_date: '2026-10-01' }),
      makeEpisode({ tmdb_id: 3, episode_number: 3, air_date: '2026-10-02' }),
    ]);
    expect(buildUpcomingItems([entry], now).map((item) => item.episodeId)).toEqual([2]);
  });
});
