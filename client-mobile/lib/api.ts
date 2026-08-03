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
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, newAccessToken);
    if (newRefreshToken) {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, newRefreshToken);
    }
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
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      return { status: 'expired' };
    }
    return { status: 'transient_failure' };
  }
}

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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