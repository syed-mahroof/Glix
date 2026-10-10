jest.mock('../lib/api', () => ({ api: { get: jest.fn() } }));
import { api } from '../lib/api';
import { useWatchStore } from '../store/watchStore';

beforeEach(() => {
  jest.useFakeTimers();
  (api.get as jest.Mock).mockReset();
  useWatchStore.setState({ yearReview: null, isLoadingYearReview: false, yearReviewError: null });
});
afterEach(() => jest.useRealTimers());

it('sends the requested year and device timezone without mixing generic analytics loading state', async () => {
  useWatchStore.setState({ isLoadingAnalytics: true });
  (api.get as jest.Mock).mockResolvedValue({ data: { year: 2026, movies_watched: 12 } });
  await useWatchStore.getState().fetchYearReview(2026);
  expect(api.get).toHaveBeenCalledWith('/analytics/year-review/', { params: { year: 2026, timezone: expect.any(String) } });
  expect(useWatchStore.getState().yearReview?.movies_watched).toBe(12);
  expect(useWatchStore.getState().isLoadingAnalytics).toBe(true);
  expect(useWatchStore.getState().isLoadingYearReview).toBe(false);
});

it('ignores the old year response when the user changes years during a fetch', async () => {
  let resolve: (value: unknown) => void = () => {};
  (api.get as jest.Mock).mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce({ data: { year: 2025 } });
  const earlier = useWatchStore.getState().fetchYearReview(2026);
  await useWatchStore.getState().fetchYearReview(2025);
  resolve({ data: { year: 2026 } });
  await earlier;
  expect(useWatchStore.getState().yearReview?.year).toBe(2025);
});
