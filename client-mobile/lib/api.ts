// client-mobile/lib/api.ts
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Determine the correct backend host:
//   - Web (browser):        localhost — same machine
//   - Mobile (Expo Go):     use the Metro bundler IP (same host as the dev server)
//   - Android Emulator:     10.0.2.2 maps to the host machine
//   - All overridden by:    EXPO_PUBLIC_API_URL in .env
function getDevApiUrl(): string {
  if (Platform.OS === 'web') {
    return 'http://localhost:8001/api/v1';
  }
  
  // If we are running in an emulator (not a physical device)
  if (!Constants.isDevice) {
    if (Platform.OS === 'android') {
      return 'http://10.0.2.2:8001/api/v1'; // Android Emulator loopback alias
    }
    return 'http://localhost:8001/api/v1'; // iOS Simulator
  }

  // On a real physical device in Expo Go, use the Metro host IP
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:8001/api/v1`;
  }
  
  return 'http://localhost:8001/api/v1';
}

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? getDevApiUrl();

export const ACCESS_TOKEN_KEY = 'access_token';
export const REFRESH_TOKEN_KEY = 'refresh_token';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
}

// Transient-failure retry for idempotent reads. User-reported bug
// (2026-07-21): screens intermittently showed "Can't reach Glix right now"
// (lib/errors.ts) on a phone with a fine connection — a single dropped
// request (Render free-tier cold start, one wifi blip) was read as a hard
// failure with no retry anywhere in the stack. Bounded to GET requests only
// (safe to repeat) and a couple of short-backoff attempts — enough to
// absorb a blip without making a genuinely offline user wait a long time
// for the eventual real error. Same reasoning as pollImportJob's
// consecutive-failure tolerance in lib/migration.ts.
const MAX_NETWORK_RETRIES = 2;
const RETRY_DELAYS_MS = [600, 1500];

function isRetryableFailure(error: AxiosError): boolean {
  // A request the caller itself aborted (AbortController — see
  // discoverStore.ts's in-flight-request dedup) must never be retried:
  // without this check, `!error.response` below reads a deliberate
  // cancellation identically to a dropped connection and retries the very
  // request the caller just superseded, silently undoing the point of
  // cancelling it.
  if (axios.isCancel(error)) return false;
  // No `response` at all means the request never got a reply (timeout,
  // connection refused, DNS hiccup) — worth a retry. A 4xx got a real
  // answer from the server and will fail the same way again.
  if (!error.response) return true;
  return error.response.status >= 500;
}

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  // 15s, not 10s: TMDBService's retry/backoff chain on the backend
  // (backend/core/services.py) can legitimately take several seconds under
  // a transient TMDB rate-limit — a client timeout shorter than the
  // backend's own worst-case retry latency turns "TMDB was briefly slow"
  // into a hard client-side failure. Tuned together with that retry
  // strategy so the two stay comfortably within each other's bounds.
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;

/**
 * Registered by the root layout so a definitive refresh failure can
 * redirect to /login. lib/api.ts has no router access of its own.
 */
export function setSessionExpiredHandler(handler: SessionExpiredHandler | null) {
  sessionExpiredHandler = handler;
}

// In-memory cache over the SecureStore-backed access token. Every request
// used to pay a native keychain round trip (SecureStore.getItemAsync) even
// though the token only changes on login/refresh/logout — Profile focus
// alone is 4 requests, Analytics 6.
//
// `undefined` vs `null` is a deliberate three-state cache, not two:
// undefined = never read yet (or invalidated) → hit SecureStore.
// null      = definitively absent (logged out) → skip SecureStore entirely.
// Collapsing the two would make a logged-out app pay the keychain cost on
// every request forever.
let cachedAccessToken: string | null | undefined = undefined;
let inFlightTokenRead: Promise<string | null> | null = null;

const TOKEN_READ_TIMEOUT_MS = 2000;

async function readAccessTokenFromStore(): Promise<string | null> {
  // Same timeout precedent as app/_layout.tsx's own boot-gate read —
  // SecureStore can hang indefinitely on Android/Expo Go.
  const token = await Promise.race([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SecureStore timeout')), TOKEN_READ_TIMEOUT_MS)
    ),
  ]);
  cachedAccessToken = token;
  return token;
}

/**
 * Single-flighted: concurrent callers during a cold cache share one
 * keychain read instead of firing one each. Caches only on success — a
 * timeout/error rejects instead of being cached as `null`, so a transient
 * keychain hang doesn't get mistaken for "no token" on the next call
 * (poisoning the cache here would reproduce the "sometimes automatically
 * logged out" bug already fixed twice in performRefresh below).
 */
export async function getAccessToken(): Promise<string | null> {
  if (cachedAccessToken !== undefined) return cachedAccessToken;
  if (!inFlightTokenRead) {
    inFlightTokenRead = readAccessTokenFromStore().finally(() => {
      inFlightTokenRead = null;
    });
  }
  return inFlightTokenRead;
}

/**
 * Assigns the cache synchronously, before either await below — a request
 * racing this call (e.g. one already queued behind a 401) sees the new
 * token immediately rather than the stale one, which is what makes
 * refresh-token rotation correct.
 */
export async function setTokens(access: string, refresh?: string): Promise<void> {
  cachedAccessToken = access;
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
  if (refresh) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
  }
}

export async function clearTokens(): Promise<void> {
  cachedAccessToken = null;
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

/** Reads the refresh token directly — never cached, since its only caller
 *  (settings.tsx's logout flow, to invalidate it server-side) needs it
 *  exactly once per session. */
export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function resolveQueue(token: string | null) {
  refreshQueue.forEach((resolve) => resolve(token));
  refreshQueue = [];
}

/**
 * `expired` — the server gave a definitive rejection (401/403: the refresh
 * token itself is invalid, expired, or was already blacklisted by a prior
 * rotation) — the session really is over.
 * `transient_failure` — the refresh request itself didn't complete cleanly
 * (network blip, timeout, a 5xx from the backend) — this says nothing
 * about whether the refresh token is still good.
 */
type RefreshOutcome =
  | { status: 'success'; token: string }
  | { status: 'expired' }
  | { status: 'transient_failure' };

async function performRefresh(): Promise<RefreshOutcome> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) return { status: 'expired' };

  try {
    // Deliberately bypass the shared `api` instance here so this call
    // never re-enters the response interceptor below.
    const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
      refresh: refreshToken,
    });
    const newAccessToken: string = response.data.access;
    const newRefreshToken: string | undefined = response.data.refresh;
    await setTokens(newAccessToken, newRefreshToken);
    return { status: 'success', token: newAccessToken };
  } catch (err) {
    // Bug fix (2026-08-03, user-reported "sometimes automatically logged
    // out"): this used to treat ANY failure here — including a network
    // blip, a request timeout, or a transient 5xx from the backend, none
    // of which say anything about the refresh token itself — identically
    // to a genuine rejection, wiping both tokens and forcing a hard
    // redirect to /login even though the 30-day refresh token was still
    // perfectly valid. Only a real 401/403 response means the server
    // actually rejected the token; everything else is a failed *attempt*,
    // not proof the session is over, so the stored tokens survive it and
    // the next natural request just retries the whole flow fresh.
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status === 401 || status === 403) {
      await clearTokens();
      return { status: 'expired' };
    }
    return { status: 'transient_failure' };
  }
}

api.interceptors.request.use(async (config) => {
  try {
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Keychain read timed out — proceed without a token. If one was
    // actually needed the request 401s and the refresh flow below retries
    // the read fresh, same "safe either way" reasoning as the boot-gate
    // check in app/_layout.tsx.
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;

    if (
      originalRequest &&
      (originalRequest.method ?? 'get').toLowerCase() === 'get' &&
      isRetryableFailure(error)
    ) {
      const retryCount = originalRequest._retryCount ?? 0;
      if (retryCount < MAX_NETWORK_RETRIES) {
        originalRequest._retryCount = retryCount + 1;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[retryCount] ?? 1500)
        );
        return api(originalRequest);
      }
    }

    const isAuthEndpoint =
      originalRequest?.url?.includes('/auth/login/') ||
      originalRequest?.url?.includes('/auth/register/') ||
      originalRequest?.url?.includes('/auth/refresh/');

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((token) => {
          if (!token) {
            reject(error);
            return;
          }
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(api(originalRequest));
        });
      });
    }

    isRefreshing = true;
    const outcome = await performRefresh();
    isRefreshing = false;
    resolveQueue(outcome.status === 'success' ? outcome.token : null);

    if (outcome.status !== 'success') {
      // Only a genuine rejection ends the session — a transient failure
      // just fails this one request and leaves the stored tokens intact
      // for the next attempt (see performRefresh's docstring).
      if (outcome.status === 'expired') {
        sessionExpiredHandler?.();
      }
      return Promise.reject(error);
    }

    originalRequest.headers = originalRequest.headers ?? {};
    originalRequest.headers.Authorization = `Bearer ${outcome.token}`;
    return api(originalRequest);
  }
);

export default api;