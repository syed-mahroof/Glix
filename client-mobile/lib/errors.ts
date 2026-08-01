// client-mobile/lib/errors.ts
import axios from 'axios';

// User-reported bug (2026-07-15): intermittent "Network Error" text showing
// up across the app (Discover, movie/show detail, etc.) whenever a request
// genuinely failed to reach the backend. Root cause: this function fell
// through to axios's own `error.message`, and for a request that never got
// a response at all (timeout, connection refused, DNS failure — the
// backend's TMDB retry/backoff chain can legitimately take longer than the
// client timeout under a TMDB rate-limit — see lib/api.ts and
// TMDBService.__init__'s retry_strategy), axios's `error.message` on React
// Native is literally the raw string "Network Error" (or "timeout of
// Xms exceeded" for ECONNABORTED) — an unbranded, technical string with no
// actionable guidance, surfaced verbatim to the user. Every screen that
// calls this shared helper gets the fix for free.
export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined;
    if (data && typeof data.detail === 'string' && data.detail.length > 0) {
      return data.detail;
    }
    // DRF field-level validation errors (raised from a serializer's
    // validate_<field>, e.g. UserProfileSerializer.validate_username) come
    // back shaped {"username": ["That username is already taken."]}, not
    // {"detail": "..."} — falling through to error.message below would
    // discard the specific message for axios's generic "Request failed
    // with status code 400". Ported from register.tsx's local duplicate of
    // this function (PROJECT_STATUS.md's tracked "error extraction
    // duplicated" debt) so every screen gets field-error messages, not
    // just Register.
    if (data && typeof data === 'object') {
      const firstKey = Object.keys(data)[0];
      const firstValue = firstKey ? data[firstKey] : undefined;
      if (Array.isArray(firstValue) && typeof firstValue[0] === 'string') {
        return `${firstKey}: ${firstValue[0]}`;
      }
    }
    if (error.code === 'ECONNABORTED') {
      return "This is taking longer than expected. Check your connection and try again.";
    }
    if (!error.response) {
      return "Can't reach Glix right now. Check your connection and try again.";
    }
    return error.message || 'Something went wrong. Please try again.';
  }
  // Non-axios errors (native-module errors — GoogleSignin, file pickers,
  // etc. — or a plain `throw new Error('...')` elsewhere in the app) used
  // to fall straight through to the generic string below, discarding
  // whatever specific message the throw site had already worked out. That
  // made every non-network failure equally uninformative — e.g. Google
  // Sign-In's own "Google did not return an ID token." never reached the
  // user, always replaced with "An unexpected error occurred." Preserve a
  // real message when one exists; only fall back when there truly isn't one.
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}