import AsyncStorage from '@react-native-async-storage/async-storage';

import { createDebouncedStorage, flushPersist, markStorageHydrated } from '../lib/persistStorage';

describe('persistStorage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (AsyncStorage.setItem as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Bug fix (2026-08-07, "Default layout resets on relaunch"): setItem() is
  // a no-op until markStorageHydrated(storage) has been called — see
  // persistStorage.ts's bug-fix note for the full pre-hydration-write-
  // clobbers-real-data writeup. Every other test in this file calls it up
  // front to exercise the steady-state (post-hydration) behavior the rest
  // of the suite already covered; this one is the regression test for the
  // gate itself.
  it('drops writes made before markStorageHydrated() is called, instead of queuing them', async () => {
    const storage = createDebouncedStorage<{ count: number }>();

    storage.setItem('watchtracker-store', { state: { count: 1 }, version: 1 });
    jest.advanceTimersByTime(600);
    await jest.runOnlyPendingTimersAsync();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    // Once hydration is reported done, writes flow through normally.
    markStorageHydrated(storage);
    storage.setItem('watchtracker-store', { state: { count: 2 }, version: 1 });
    jest.advanceTimersByTime(600);
    await jest.runOnlyPendingTimersAsync();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [, written] = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
    expect(JSON.parse(written)).toEqual({ state: { count: 2 }, version: 1 });
  });

  it('collapses rapid mutations into a single AsyncStorage write', async () => {
    const storage = createDebouncedStorage<{ count: number }>();
    markStorageHydrated(storage);

    for (let i = 0; i < 10; i++) {
      storage.setItem('watchtracker-store', { state: { count: i }, version: 1 });
    }

    jest.advanceTimersByTime(600);
    // InteractionManager.runAfterInteractions schedules via setImmediate.
    await jest.runOnlyPendingTimersAsync();

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [, written] = (AsyncStorage.setItem as jest.Mock).mock.calls[0];
    expect(JSON.parse(written)).toEqual({ state: { count: 9 }, version: 1 });
  });

  it('flushPersist forces a pending write out immediately', async () => {
    const storage = createDebouncedStorage<{ count: number }>();
    markStorageHydrated(storage);
    storage.setItem('watchtracker-store', { state: { count: 1 }, version: 1 });

    flushPersist();
    await jest.runOnlyPendingTimersAsync();

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('removeItem cancels a pending write instead of letting it resurrect the data', async () => {
    const storage = createDebouncedStorage<{ count: number }>();
    markStorageHydrated(storage);
    storage.setItem('watchtracker-store', { state: { count: 1 }, version: 1 });

    storage.removeItem('watchtracker-store');
    jest.advanceTimersByTime(600);
    await jest.runOnlyPendingTimersAsync();

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('watchtracker-store');
  });

  // C13: watchStore was the only createDebouncedStorage() consumer until
  // discoverStore/socialStore/listsStore also started using it for
  // stale-while-revalidate persistence — the original implementation
  // tracked its pending write in module-level (not per-call) variables, so
  // a second store's setItem() inside the same 600ms window silently
  // overwrote the first store's still-pending write, and only one of the
  // two ever reached AsyncStorage. Each createDebouncedStorage() call now
  // closes over its own pending state.
  it('keeps two independent stores writing through separate createDebouncedStorage() instances from clobbering each other', async () => {
    const discoverLikeStorage = createDebouncedStorage<{ feed: string }>();
    const socialLikeStorage = createDebouncedStorage<{ activity: string }>();
    markStorageHydrated(discoverLikeStorage);
    markStorageHydrated(socialLikeStorage);

    discoverLikeStorage.setItem('discover-store', { state: { feed: 'trending' }, version: 1 });
    socialLikeStorage.setItem('social-store', { state: { activity: 'reviews' }, version: 1 });

    jest.advanceTimersByTime(600);
    await jest.runOnlyPendingTimersAsync();

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
    const writtenKeys = (AsyncStorage.setItem as jest.Mock).mock.calls.map(([key]) => key);
    expect(writtenKeys).toEqual(expect.arrayContaining(['discover-store', 'social-store']));
  });

  it('flushPersist forces every pending instance out, not just the most recently created one', async () => {
    const discoverLikeStorage = createDebouncedStorage<{ feed: string }>();
    const socialLikeStorage = createDebouncedStorage<{ activity: string }>();
    markStorageHydrated(discoverLikeStorage);
    markStorageHydrated(socialLikeStorage);

    discoverLikeStorage.setItem('discover-store', { state: { feed: 'trending' }, version: 1 });
    socialLikeStorage.setItem('social-store', { state: { activity: 'reviews' }, version: 1 });

    flushPersist();
    await jest.runOnlyPendingTimersAsync();

    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
  });
});
