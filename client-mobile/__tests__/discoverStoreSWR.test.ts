// client-mobile/__tests__/discoverStoreSWR.test.ts
// C13 stale-while-revalidate: fetchFeed/fetchGenreCovers used to guard on
// "is feedData/genreCovers already populated" — correct when the store was
// purely in-memory, but wrong now that both can be non-null on mount from
// a *persisted* snapshot (store/discoverStore.ts's persist() wiring)
// before this session has ever talked to the backend. These tests prove
// the fix directly: hasFetchedFeed/hasFetchedGenreCovers, not data
// presence, gate whether a live fetch actually fires.

jest.mock('../lib/api', () => ({
  api: { get: jest.fn() },
}));

import { api } from '../lib/api';
import { useDiscoverStore } from '../store/discoverStore';

const EMPTY_FEED = { type: 'tv' as const, hero: [], sections: [] };

describe('discoverStore stale-while-revalidate (C13)', () => {
  beforeEach(() => {
    // discoverStore is now persist()-wrapped (C13) — every setState below
    // also arms createDebouncedStorage()'s real 600ms write timer. Fake
    // timers keep that from firing (and touching InteractionManager) after
    // this file's Jest environment has already torn down.
    jest.useFakeTimers();
    (api.get as jest.Mock).mockReset();
    useDiscoverStore.setState({
      feedData: { tv: null, movie: null },
      feedFetchedAt: { tv: null, movie: null },
      hasFetchedFeed: { tv: false, movie: false },
      isLoadingFeed: false,
      feedError: null,
      genreCovers: { tv: {}, movie: {} },
      hasFetchedGenreCovers: { tv: false, movie: false },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('still fetches live when feedData is already populated from a rehydrated snapshot, as long as hasFetchedFeed is false', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: EMPTY_FEED });
    // Simulates what persist() rehydration leaves behind on a cold start —
    // real data present, but no live fetch has happened this session yet.
    useDiscoverStore.setState({
      feedData: { tv: EMPTY_FEED, movie: null },
      hasFetchedFeed: { tv: false, movie: false },
    });

    await useDiscoverStore.getState().fetchFeed('tv');

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(useDiscoverStore.getState().hasFetchedFeed.tv).toBe(true);
    expect(useDiscoverStore.getState().feedFetchedAt.tv).not.toBeNull();
  });

  it('skips a second live fetch for the same segment within the same session', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: EMPTY_FEED });

    await useDiscoverStore.getState().fetchFeed('tv');
    await useDiscoverStore.getState().fetchFeed('tv');

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('fetches each segment independently — fetching tv does not mark movie as fetched', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: EMPTY_FEED });

    await useDiscoverStore.getState().fetchFeed('tv');

    expect(useDiscoverStore.getState().hasFetchedFeed.tv).toBe(true);
    expect(useDiscoverStore.getState().hasFetchedFeed.movie).toBe(false);
  });

  it('genre covers: still fetches live when already populated from a rehydrated snapshot, gated on hasFetchedGenreCovers not data presence', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ id: 1, backdrop_path: null, poster_path: null }] });
    useDiscoverStore.setState({
      genreCovers: { tv: { 1: { id: 1, backdrop_path: null, poster_path: null } }, movie: {} },
      hasFetchedGenreCovers: { tv: false, movie: false },
    });

    await useDiscoverStore.getState().fetchGenreCovers('tv');

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(useDiscoverStore.getState().hasFetchedGenreCovers.tv).toBe(true);
  });
});
