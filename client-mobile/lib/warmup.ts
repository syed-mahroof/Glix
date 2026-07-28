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
