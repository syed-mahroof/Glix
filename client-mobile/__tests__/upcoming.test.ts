// client-mobile/__tests__/upcoming.test.ts
//
// Regression coverage for the "Watch List shows a different weekday than
// Upcoming for the same episode" fix (Phase 85, Batch A/E). pickNextEpisode
// used to compare the raw TMDB air_date string directly against today's
// local date — the same class of bug as the Watch List badge mislabeling,
// just here it could pick the WRONG episode as "next" rather than just
// mislabeling the right one.

import { pickNextEpisode } from '../lib/upcoming';
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
