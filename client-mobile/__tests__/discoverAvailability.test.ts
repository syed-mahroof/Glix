jest.mock('../lib/api', () => ({ api: { get: jest.fn() } }));
import { api } from '../lib/api';
import { useDiscoverStore } from '../store/discoverStore';

beforeEach(() => {
  jest.useFakeTimers();
  (api.get as jest.Mock).mockReset();
  useDiscoverStore.getState().resetFilters();
  useDiscoverStore.setState({ activeSegment: 'movie', watchRegion: 'IN', filteredResults: [], filteredPage: 1, filteredTotalPages: 2 });
});
afterEach(() => jest.useRealTimers());

it('combines platform, genre, media type, country, and access on every page', async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { results: [], page: 1, total_pages: 2 } });
  useDiscoverStore.setState({ selectedProviderIds: [350], selectedGenreId: 35, sortOrder: 'popular', monetization: 'flatrate' });
  await useDiscoverStore.getState().fetchFilteredResults();
  await useDiscoverStore.getState().loadMoreFilteredResults();
  expect((api.get as jest.Mock).mock.calls.map((call) => call[1].params)).toEqual([
    expect.objectContaining({ type: 'movie', genre: '35', providers: '350', region: 'IN', monetization: 'flatrate', page: '1' }),
    expect.objectContaining({ type: 'movie', genre: '35', providers: '350', region: 'IN', monetization: 'flatrate', page: '2' }),
  ]);
});

it('combines New releases with platform and genre on every page, then resets it', async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { results: [], page: 1, total_pages: 2 } });
  useDiscoverStore.setState({ selectedProviderIds: [8], selectedGenreId: 35, recentReleases: true, sortOrder: 'popular' });
  await useDiscoverStore.getState().fetchFilteredResults();
  await useDiscoverStore.getState().loadMoreFilteredResults();
  for (const [, config] of (api.get as jest.Mock).mock.calls) {
    expect(config.params).toEqual(expect.objectContaining({ recent: 'true', providers: '8', genre: '35', region: 'IN' }));
  }
  useDiscoverStore.getState().resetFilters();
  expect(useDiscoverStore.getState().recentReleases).toBe(false);
});

it('does not restore obsolete filters when a canceled request resolves late', async () => {
  let resolve: (value: unknown) => void = () => {};
  (api.get as jest.Mock).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  useDiscoverStore.setState({ selectedProviderIds: [8], sortOrder: 'popular' });
  const request = useDiscoverStore.getState().fetchFilteredResults();
  useDiscoverStore.getState().resetFilters();
  resolve({ data: { results: [{ tmdb_id: 99, title: 'Stale' }], page: 1, total_pages: 1 } });
  await request;
  expect(useDiscoverStore.getState().filteredResults).toEqual([]);
  expect(useDiscoverStore.getState().isFilterActive()).toBe(false);
});

it('keeps refreshed feed data visible while requesting an explicit refresh', async () => {
  const feed = { type: 'movie' as const, hero: [], sections: [] };
  useDiscoverStore.setState({ feedData: { tv: null, movie: feed }, hasFetchedFeed: { tv: false, movie: true }, feedFetchedAt: { tv: null, movie: Date.now() } });
  (api.get as jest.Mock).mockResolvedValue({ data: feed });
  await useDiscoverStore.getState().fetchFeed('movie', true);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(useDiscoverStore.getState().feedData.movie).toEqual(feed);
});

it('keeps the TV provider catalogue when a canceled movie lookup arrives later', async () => {
  useDiscoverStore.setState({ providerOptionsKey: 'tv-IN', providerOptions: [{ provider_id: 8, provider_name: 'TV platform', logo_path: null }] });
  let resolveMovie: (value: unknown) => void = () => {};
  (api.get as jest.Mock)
    .mockImplementationOnce(() => new Promise((done) => { resolveMovie = done; }))
    .mockResolvedValueOnce({ data: { providers: [{ provider_id: 8, provider_name: 'TV platform', logo_path: null }], regions: [] } });
  const movie = useDiscoverStore.getState().fetchProviders('movie');
  await useDiscoverStore.getState().fetchProviders('tv');
  resolveMovie({ data: { providers: [{ provider_id: 119, provider_name: 'Movie platform', logo_path: null }], regions: [] } });
  await movie;
  expect(useDiscoverStore.getState().providerOptionsKey).toBe('tv-IN');
  expect(useDiscoverStore.getState().providerOptions[0].provider_id).toBe(8);
  expect(useDiscoverStore.getState().isLoadingProviders).toBe(false);
});
