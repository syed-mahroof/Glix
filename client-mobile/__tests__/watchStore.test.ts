jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from '../lib/api';
import { pickNextEpisode } from '../lib/upcoming';
import { isShowComplete, useWatchStore, type Show, type WatchlistEntry } from '../store/watchStore';

describe('watchStore', () => {
  it('initializes with default state', () => {
    const state = useWatchStore.getState();
    expect(state.watchlist).toBeDefined();
    expect(state.isLoadingWatchlist).toBe(false);
  });
});

describe('optimistic episode mutations', () => {
  function fixture() {
    const episodes = [1, 2].map((id) => ({ tmdb_id: id, season_number: 1, episode_number: id, title: 'Episode', air_date: '2020-01-01', runtime_minutes: 30, is_watched: false }));
    const entry: WatchlistEntry = {
      id: 1, status: 'TO_WATCH', is_favorite: false, ignore_catchup: false,
      watched_episode_count: 0, aired_episode_count: 2, progress_percentage: 0,
      last_watched_at: null, active_rewatch: null, seasons_cached: 1, added_at: '', updated_at: '',
      show: { tmdb_id: 100, title: 'Show', overview: '', poster_path: null, backdrop_path: null,
        first_air_date: null, status: 'RETURNING', vote_average: 0, total_seasons: 1, total_episodes: 2,
        original_language: 'en', genres: [], next_episode_air_date: null, next_episode_season_number: null,
        next_episode_number: null, next_episode_name: null, episodes },
    };
    const empty = { count: 0, current_page: 1, total_pages: 1, next: null, previous: null, results: [] };
    return { to_watch: { ...empty, count: 1, results: [entry] }, up_to_date: empty, archived: empty };
  }
  const history = { count: 0, current_page: 1, total_pages: 1, next: null, previous: null, results: [] };
  beforeEach(() => {
    jest.useFakeTimers();
    (api.get as jest.Mock).mockReset().mockImplementation((url: string) => Promise.resolve({
      data: url.startsWith('/watchlist') ? useWatchStore.getState().watchlist : url.startsWith('/watch-history') ? useWatchStore.getState().history : null,
    }));
    (api.post as jest.Mock).mockReset();
    useWatchStore.setState({ watchlist: fixture(), history, profile: null, error: null, completedShow: null });
    jest.spyOn(useWatchStore.getState(), 'syncWidgetData').mockImplementation(async () => {});
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it('moves a final-episode cascade out of Watch Next while keeping watched history', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { total_time_watched: 60 } });
    await useWatchStore.getState().bulkToggleWatchState([1, 2], true);
    const state = useWatchStore.getState();
    expect(state.watchlist.to_watch.results).toHaveLength(0);
    expect(pickNextEpisode(state.watchlist.up_to_date.results[0])).toBeNull();
    expect(state.history.results).toHaveLength(2);
  });

  it('reconciles server-cached predecessor episodes after a successful cascade', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { total_time_watched: 90 } });
    await useWatchStore.getState().bulkToggleWatchState([1, 2, 3], true);
    expect(api.get).toHaveBeenCalledWith('/watchlist/?page_size=all');
    expect((api.get as jest.Mock).mock.calls.some(([url]) => url.startsWith('/watch-history'))).toBe(true);
  });

  it('rejects a duplicate pending tap and advances only once', async () => {
    let resolve: (value: unknown) => void = () => {};
    (api.post as jest.Mock).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const first = useWatchStore.getState().toggleWatchState(1);
    await useWatchStore.getState().toggleWatchState(1);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(useWatchStore.getState().watchlist.to_watch.results[0].watched_episode_count).toBe(1);
    resolve({ data: { watched: true, total_time_watched: 30 } });
    await first;
  });

  it('rolls back only the failed episode while preserving a concurrent successful watch', async () => {
    let rejectFirst: (error: Error) => void = () => {};
    (api.post as jest.Mock)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ data: { watched: true, total_time_watched: 30 } });
    const first = useWatchStore.getState().toggleWatchState(1);
    await useWatchStore.getState().toggleWatchState(2);
    rejectFirst(new Error('Network unavailable'));
    await first;
    const state = useWatchStore.getState();
    expect(state.watchlist.to_watch.results[0].show.episodes.map((ep) => ep.is_watched)).toEqual([false, true]);
    expect(state.history.results.map((row) => row.episode.tmdb_id)).toEqual([2]);
    expect(state.history.count).toBe(1);
    expect(state.watchlist.to_watch.results[0].last_watched_at).toBe(state.history.results[0].watched_at);
  });

  it('decrements history totals when unwatching an episode outside the loaded history page', async () => {
    const buckets = fixture();
    buckets.to_watch.results[0].show.episodes[0].is_watched = true;
    buckets.to_watch.results[0].watched_episode_count = 1;
    useWatchStore.setState({ watchlist: buckets, history: { ...history, count: 100 } });
    (api.post as jest.Mock).mockResolvedValue({ data: { watched: false, total_time_watched: 0 } });
    await useWatchStore.getState().toggleWatchState(1);
    expect(useWatchStore.getState().history.count).toBe(99);
  });

  it('celebrates series completion only after the server accepts the final episode', async () => {
    const buckets = fixture();
    buckets.to_watch.results[0].show.status = 'ENDED';
    buckets.to_watch.results[0].show.episodes[0].is_watched = true;
    buckets.to_watch.results[0].watched_episode_count = 1;
    useWatchStore.setState({ watchlist: buckets });
    let resolve: (value: unknown) => void = () => {};
    (api.post as jest.Mock).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = useWatchStore.getState().toggleWatchState(2);
    expect(useWatchStore.getState().completedShow).toBeNull();
    resolve({ data: { watched: true, total_time_watched: 60 } });
    await pending;
    expect(useWatchStore.getState().completedShow?.showId).toBe(100);
  });

  it('accepts the server watch state when another session changed the episode first', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { watched: false, total_time_watched: 0 } });
    await useWatchStore.getState().toggleWatchState(1);
    expect(useWatchStore.getState().watchlist.to_watch.results[0].show.episodes[0].is_watched).toBe(false);
    expect(useWatchStore.getState().history.count).toBe(0);
  });

  it('drops a watchlist response captured before a watch mutation started', async () => {
    const stale = fixture();
    let resolve: (value: unknown) => void = () => {};
    (api.get as jest.Mock).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    (api.post as jest.Mock).mockResolvedValue({ data: { watched: true, total_time_watched: 30 } });
    const fetch = useWatchStore.getState().fetchWatchlist();
    await useWatchStore.getState().toggleWatchState(1);
    resolve({ data: stale });
    await fetch;
    expect(useWatchStore.getState().watchlist.to_watch.results[0].show.episodes[0].is_watched).toBe(true);
  });

  it('removes skipped unaired bulk episodes without reverting episodes the server accepted', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { watched: true, total_time_watched: 30, skipped_unaired_ids: [2] } });
    await useWatchStore.getState().bulkToggleWatchState([1, 2, 2], true);
    const entry = useWatchStore.getState().watchlist.to_watch.results[0];
    expect(entry.show.episodes.map((ep) => ep.is_watched)).toEqual([true, false]);
    expect(entry.watched_episode_count).toBe(1);
    expect((api.post as jest.Mock).mock.calls[0][1].episode_ids).toEqual([1, 2]);
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
