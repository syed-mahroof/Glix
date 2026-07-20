import { useWatchStore } from '../store/watchStore';

describe('watchStore', () => {
  it('initializes with default state', () => {
    const state = useWatchStore.getState();
    expect(state.watchlist).toBeDefined();
    expect(state.isLoading).toBe(false);
  });
});
