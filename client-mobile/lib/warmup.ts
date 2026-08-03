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
export async function pingHealth(timeoutMs = 5000): Promise<boolean> {
  try {
    await axios.get(HEALTH_URL, { timeout: timeoutMs });
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
 */
export async function waitForBackend(
  onSlowWake?: () => void,
  totalBudgetMs = 55000
): Promise<WarmupResult> {
  const start = Date.now();
  let attempt = 0;
  let wokeSlowly = false;
  while (Date.now() - start < totalBudgetMs) {
    const perAttemptTimeout = attempt === 0 ? 4000 : 6000;
    if (await pingHealth(perAttemptTimeout)) {
      return { awake: true, wokeSlowly };
    }
    if (!wokeSlowly && Date.now() - start > 3000) {
      wokeSlowly = true;
      onSlowWake?.();
    }
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return { awake: false, wokeSlowly };
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
    let cancelled = false;
    setIsWaking(false);
    waitForBackend(() => {
      if (!cancelled) setIsWaking(true);
    }, 20000);
    return () => {
      cancelled = true;
    };
  }, [active]);
  return isWaking;
}
