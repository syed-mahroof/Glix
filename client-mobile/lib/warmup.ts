// client-mobile/lib/warmup.ts
// Render's free tier suspends the backend dyno after inactivity and can take
// 20-50s to boot back up on the next request — long enough that a normal
// request's fixed timeout (lib/api.ts's 15s, tuned for TMDB blips, plus its
// couple of short retries) legitimately exhausts before the dyno is even
// listening. User-reported bug: the app just spins, then dumps a permanent
// "Can't reach Glix right now" banner once loading.tsx's Promise.all gives
// up — that gate never actually surfaces a real error state (fetchProfile/
// fetchWatchlist swallow their own errors into store.error and always
// resolve), so `ready` flips true regardless and the user lands in the app
// already showing the failure. This module gives the boot sequence a
// dedicated, patient, cheap wake-up probe instead of overloading the normal
// per-request retry budget to also cover a multi-second cold boot.
import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './api';

const HEALTH_URL = `${API_BASE_URL}/health/`;

/** One bare health ping — deliberately not the shared `api` instance, so it
 *  never attaches an auth header or engages the 401-refresh interceptor. A
 *  sleeping dyno has nothing to authenticate against yet; this only needs
 *  to know "is anything answering". */
export async function pingHealth(timeoutMs = 5000, signal?: AbortSignal): Promise<boolean> {
  try {
    await axios.get(HEALTH_URL, { timeout: timeoutMs, signal });
    return true;
  } catch {
    return false;
  }
}

export interface WarmupResult {
  awake: boolean;
  /** True if this took long enough that the caller should have already
   *  swapped its UI to a "waking up" message. */
  wokeSlowly: boolean;
}

/**
 * Polls /health/ until the backend answers or the budget runs out.
 * `onSlowWake` fires once, the first time the wait crosses a few seconds —
 * the signal a caller uses to switch a spinner into an explanatory message
 * instead of guessing a fixed delay up front (a fast/warm dyno never sees it
 * at all, so the common case stays silent and instant).
 *
 * `signal` (Phase 83 perf), if given, stops the loop between attempts —
 * used by the shared probe below so an aborted/unsubscribed caller doesn't
 * keep polling on nobody's behalf.
 */
export async function waitForBackend(
  onSlowWake?: () => void,
  totalBudgetMs = 55000,
  signal?: AbortSignal
): Promise<WarmupResult> {
  const start = Date.now();
  let attempt = 0;
  let wokeSlowly = false;
  while (Date.now() - start < totalBudgetMs) {
    if (signal?.aborted) return { awake: false, wokeSlowly };
    const perAttemptTimeout = attempt === 0 ? 4000 : 6000;
    if (await pingHealth(perAttemptTimeout, signal)) {
      return { awake: true, wokeSlowly };
    }
    if (signal?.aborted) return { awake: false, wokeSlowly };
    if (!wokeSlowly && Date.now() - start > 3000) {
      wokeSlowly = true;
      onSlowWake?.();
    }
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return { awake: false, wokeSlowly };
}

const COLD_START_BUDGET_MS = 20000;

interface SharedProbe {
  controller: AbortController;
  startedAt: number;
  wokeSlowly: boolean;
  subscribers: Set<(wokeSlowly: boolean) => void>;
}

// Phase 83 perf: useColdStartHint used to start its own independent
// waitForBackend loop per call site — up to four concurrent 20s polling
// loops in practice (Community's Discussions and Activity tabs, Discover,
// plus _layout.tsx's own one-shot ping), all hammering /health/ in parallel
// against the single-container free-tier backend they're waiting to wake
// up, competing with the very requests they exist to unblock. One shared
// probe per cold-start episode fixes that: the first caller starts it, late
// joiners subscribe to the same in-flight promise instead of starting a
// second one, and the last one to unmount aborts it so nothing polls with
// no listener left to tell.
let sharedProbe: SharedProbe | null = null;

/** Exported for direct testing — useColdStartHint is a thin useEffect/
 *  useState wrapper around this; the dedup/subscriber logic that actually
 *  matters lives here and needs no renderer to exercise. */
export function joinSharedProbe(onSlowWake: (wokeSlowly: boolean) => void): () => void {
  const isFresh = sharedProbe !== null && Date.now() - sharedProbe.startedAt < COLD_START_BUDGET_MS;
  if (!isFresh) {
    // No probe running (never started, already finished, or aborted by the
    // last subscriber leaving) — a screen mounting now gets a fresh one
    // rather than silently getting no hint.
    const controller = new AbortController();
    const probe: SharedProbe = {
      controller,
      startedAt: Date.now(),
      wokeSlowly: false,
      subscribers: new Set(),
    };
    sharedProbe = probe;
    waitForBackend(
      () => {
        probe.wokeSlowly = true;
        probe.subscribers.forEach((fn) => fn(true));
      },
      COLD_START_BUDGET_MS,
      controller.signal
    ).finally(() => {
      if (sharedProbe === probe) sharedProbe = null;
    });
  }

  const probe = sharedProbe as SharedProbe;
  probe.subscribers.add(onSlowWake);
  // Joined after the probe already crossed the slow-wake threshold — give
  // this late subscriber today's answer immediately instead of making it
  // wait for a notification that already fired for everyone else.
  if (probe.wokeSlowly) onSlowWake(true);

  return () => {
    probe.subscribers.delete(onSlowWake);
    if (probe.subscribers.size === 0 && sharedProbe === probe) {
      probe.controller.abort();
      sharedProbe = null;
    }
  };
}

/**
 * Bug fix (2026-08-03, "everything blank after the update" report): only
 * the login/register boot path (app/loading.tsx) ever ran waitForBackend's
 * cold-start wait — a returning user with a token already in SecureStore
 * skips straight from _layout.tsx into the tabs the moment the *local*
 * auth check resolves, with no idea whether Render's free-tier dyno (which
 * restarts, and goes cold again, on every backend redeploy) is actually
 * awake yet. Screens with a persisted fallback (Shows/Movies Hub, reading
 * AsyncStorage-cached watchlist data) painted real content regardless and
 * looked fine; Discover and Community have no persisted data at all, so
 * they had nothing to show except a bare spinner for however long the dyno
 * took to wake — up to the ~47s lib/api.ts's own transient-retry budget
 * allows before its error card even appears, comfortably long enough to
 * look "frozen" with zero explanation. This hook is a one-shot, non-blocking
 * hint for exactly those screens: it never gates or retries the caller's
 * own fetch, it just flips true a few seconds in if the backend turns out
 * to be waking, so those screens can swap their spinner for the same
 * "waking up" message loading.tsx already shows on the login path.
 */
export function useColdStartHint(active: boolean): boolean {
  const [isWaking, setIsWaking] = useState(false);
  useEffect(() => {
    if (!active) return;
    setIsWaking(false);
    const leave = joinSharedProbe(() => setIsWaking(true));
    return leave;
  }, [active]);
  return isWaking;
}
