jest.mock('../lib/api', () => ({
  api: { get: jest.fn() },
}));

import { api } from '../lib/api';
import { isShowComplete, useWatchStore, type Show, type WatchlistEntry } from '../store/watchStore';

describe('watchStore', () => {
  it('initializes with default state', () => {
    const state = useWatchStore.getState();
    expect(state.watchlist).toBeDefined();
    expect(state.isLoadingWatchlist).toBe(false);
  });
});

// Bug fix (Phase 85, Batch A/E) — "season list shows 0% watched right after
// marking episodes". fetchWatchlist() had no ordering guarantee between
// overlapping calls; a stale response landing after a newer one could
// silently overwrite fresh data with the pre-toggle snapshot.
describe('fetchWatchlist out-of-order guard', () => {
  const EMPTY_PAGE = { count: 0, total_pages: 1, current_page: 1, next: null, previous: null, results: [] };
  const bucketsWithToWatchCount = (count: number) => ({
    to_watch: { ...EMPTY_PAGE, count },
    up_to_date: EMPTY_PAGE,
    archived: EMPTY_PAGE,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    (api.get as jest.Mock).mockReset();
    useWatchStore.setState({ watchlist: bucketsWithToWatchCount(0), isLoadingWatchlist: false, error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('discards a stale response that resolves after a newer fetchWatchlist() call has already started', async () => {
    // Simulates the reported race: the season screen's mount-time fetch
    // (STALE, resolves LAST here) started before its own post-toggle
    // refetch (FRESH, resolves FIRST) — the fresh one must win regardless
    // of arrival order.
    let resolveStale: (v: unknown) => void = () => {};
    const stalePromise = new Promise((resolve) => {
      resolveStale = resolve;
    });
    (api.get as jest.Mock)
      .mockImplementationOnce(() => stalePromise)
      .mockImplementationOnce(() => Promise.resolve({ data: bucketsWithToWatchCount(1) }));

    const staleCall = useWatchStore.getState().fetchWatchlist(); // starts first, resolves last
    const freshCall = useWatchStore.getState().fetchWatchlist(); // starts second, resolves first

    await freshCall;
    expect(useWatchStore.getState().watchlist.to_watch.count).toBe(1);

    resolveStale({ data: bucketsWithToWatchCount(999) });
    await staleCall;

    // The stale response must NOT have overwritten the fresh one.
    expect(useWatchStore.getState().watchlist.to_watch.count).toBe(1);
  });

  it('applies the response normally when calls are not overlapping', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: bucketsWithToWatchCount(5) });
    await useWatchStore.getState().fetchWatchlist();
    expect(useWatchStore.getState().watchlist.to_watch.count).toBe(5);
  });
});

// Bug fix (Phase 85, Batch A/E) — "series complete + confetti while later
// seasons remain". isShowComplete() is the single shared predicate that
// replaced two independently copy-pasted completion checks.
describe('isShowComplete', () => {
  const baseShow: Show = {
    tmdb_id: 1,
    title: 'Test Show',
    overview: '',
    poster_path: null,
    backdrop_path: null,
    first_air_date: null,
    status: 'ENDED',
    vote_average: 0,
    total_seasons: 2,
    total_episodes: 20,
    original_language: 'en',
    genres: [],
    next_episode_air_date: null,
    next_episode_season_number: null,
    next_episode_number: null,
    next_episode_name: null,
    episodes: [],
  };
  const baseEntry: WatchlistEntry = {
    id: 1,
    show: baseShow,
    status: 'TO_WATCH',
    is_favorite: false,
    ignore_catchup: false,
    watched_episode_count: 10,
    aired_episode_count: 10,
    progress_percentage: 100,
    last_watched_at: null,
    active_rewatch: null,
    seasons_cached: 2,
    added_at: '',
    updated_at: '',
  };

  it('is true for an ENDED show with full season coverage and watched >= aired', () => {
    expect(isShowComplete(baseEntry)).toBe(true);
  });

  it('is true for a CANCELED show under the same conditions — not just the literal string ENDED', () => {
    const entry = { ...baseEntry, show: { ...baseShow, status: 'CANCELED' as const } };
    expect(isShowComplete(entry)).toBe(true);
  });

  it('is false when later seasons are not yet cached, even though every CACHED episode is watched — the actual bug this fix closes', () => {
    const entry = { ...baseEntry, seasons_cached: 1 }; // total_seasons is 2
    expect(isShowComplete(entry)).toBe(false);
  });

  it('is false for a RETURNING show even with full coverage and watched >= aired', () => {
    const entry = { ...baseEntry, show: { ...baseShow, status: 'RETURNING' as const } };
    expect(isShowComplete(entry)).toBe(false);
  });

  it('is false when nothing has aired yet (aired_episode_count === 0)', () => {
    const entry = { ...baseEntry, aired_episode_count: 0, watched_episode_count: 0 };
    expect(isShowComplete(entry)).toBe(false);
  });

  it('is false when the show is still behind (watched < aired)', () => {
    const entry = { ...baseEntry, watched_episode_count: 9 };
    expect(isShowComplete(entry)).toBe(false);
  });

  it('is false when total_seasons is 0 (show metadata not fully synced yet) — conservative by construction', () => {
    const entry = { ...baseEntry, show: { ...baseShow, total_seasons: 0 }, seasons_cached: 0 };
    expect(isShowComplete(entry)).toBe(false);
  });
});
