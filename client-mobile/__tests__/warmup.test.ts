describe('cold-start probe singleton (C5)', () => {
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    mockGet.mockReset();
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { get: mockGet },
    }));
    // warmup.ts only needs API_BASE_URL from here, but the real module also
    // calls axios.create(...) at import time (for the shared `api` client),
    // which the bare { get } mock above doesn't provide.
    jest.doMock('../lib/api', () => ({ API_BASE_URL: 'http://mock-api' }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dedupes concurrent subscribers into a single underlying health-check chain', () => {
    mockGet.mockResolvedValue({ data: {} });
    const { joinSharedProbe } = require('../lib/warmup');

    // Three call sites mounting back to back (Community's Discussions tab,
    // Activity tab, Discover) — used to mean three independent 20s polling
    // loops hammering /health/ in parallel.
    joinSharedProbe(jest.fn());
    joinSharedProbe(jest.fn());
    joinSharedProbe(jest.fn());

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('notifies a subscriber that joins late with the answer the shared probe already has', async () => {
    mockGet.mockRejectedValue(new Error('not awake yet'));
    const { joinSharedProbe } = require('../lib/warmup');

    const earlyCb = jest.fn();
    joinSharedProbe(earlyCb);

    // waitForBackend flags "slow wake" once elapsed time crosses 3s, checked
    // after each failed attempt — two of its 2.5s retry ticks gets there.
    await jest.advanceTimersByTimeAsync(2500);
    await jest.advanceTimersByTimeAsync(2500);

    expect(earlyCb).toHaveBeenCalledWith(true);
    const callsBeforeLateJoin = mockGet.mock.calls.length;

    const lateCb = jest.fn();
    joinSharedProbe(lateCb);

    // Told immediately — it doesn't have to wait out its own 3s to learn
    // what every other subscriber already knows.
    expect(lateCb).toHaveBeenCalledWith(true);
    // ...and didn't start a second polling chain to find out.
    expect(mockGet).toHaveBeenCalledTimes(callsBeforeLateJoin);
  });

  it('aborts the shared probe once every subscriber has left, so a later mount starts fresh', () => {
    mockGet.mockResolvedValue({ data: {} });
    const { joinSharedProbe } = require('../lib/warmup');

    const leave = joinSharedProbe(jest.fn());
    expect(mockGet).toHaveBeenCalledTimes(1);

    leave();
    joinSharedProbe(jest.fn());

    // Nobody was left listening to the first probe, so this is a genuinely
    // new chain for the new mount — not silently getting no hint because a
    // stale probe object was still sitting there unaborted.
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
