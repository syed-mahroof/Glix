# DEPLOYMENT_READY.md — Glix V2 Pre-Deployment Rapid Audit

Date: 2026-07-19 (updated same day with 2 feature additions requested mid-audit — see §5)

## 1. Security & Config — PASS

- `backend/config/settings/prod.py`: `DEBUG = False`; `SECRET_KEY` required from `DJANGO_SECRET_KEY` env (raises `ImproperlyConfigured` if missing — fails closed); `ALLOWED_HOSTS` required from env (fails closed); `CORS_ALLOW_ALL_ORIGINS = False` with explicit `CORS_ALLOWED_ORIGINS` from env.
- HSTS: `SECURE_SSL_REDIRECT` (env-driven, defaults `True`), `SESSION_COOKIE_SECURE = True`, `CSRF_COOKIE_SECURE = True`, `SECURE_HSTS_SECONDS = 31536000`, `SECURE_HSTS_INCLUDE_SUBDOMAINS = True`, `SECURE_HSTS_PRELOAD = True`.
- `TMDB_API_KEY` sourced exclusively from env (`backend/config/settings/base.py:142`).
- TMDB key exposure: already patched pre-existing — `core/services.py` installs a logging filter (`_API_KEY_PATTERN`) that masks `api_key=...` in every log record and urllib3 retry log line. Key travels as a query param (TMDB's own API contract), never in headers, so there's nothing to leak via headers.
- `backend/.env.prod` already declares all required production secrets/config keys (`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `REDIS_CACHE_URL`, `TMDB_API_KEY`, `GOOGLE_OAUTH_CLIENT_IDS`, `APPLE_AUDIENCES`, `EMAIL_HOST_USER/PASSWORD`, `CORS_ALLOWED_ORIGINS`) — no localhost fallback relied upon in production.

No fixes needed in this category.

## 2. API & Connection Health — PASS, with one open item

- `client-mobile/lib/api.ts`: base URL resolution is dynamic per platform (web/emulator/physical device via Metro `hostUri`), always overridable by `EXPO_PUBLIC_API_URL`. This is correct for **development**.
- TMDB 429 handling: `backend/core/services.py` uses a `urllib3` `Retry` strategy with `status_forcelist=[429, 500, 502, 503, 504]`, `backoff_factor=0.5`, and a dedicated `TMDBRateLimitError` raised on a persistent 429. Key never appears in headers or unmasked logs.
- Celery: `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` / `REDIS_CACHE_URL` all read from env with production values supplied via `.env.prod` (not relying on the `localhost` dev fallback).

**Open item — needs your input before shipping a production build:**
`client-mobile/eas.json`'s `production` build profile has no `env.EXPO_PUBLIC_API_URL`. Since `EXPO_PUBLIC_*` vars are baked into the JS bundle at build time, a production build with this unset will fall through `getDevApiUrl()` to `http://localhost:8001/api/v1` (the phone's own localhost) — a hard runtime failure in production. **Confirmed with you (2026-07-19): no production backend is deployed yet**, so this was intentionally left as a documented blocker rather than filled with a guessed value. Before running a production EAS build, add:
```json
"production": {
  "autoIncrement": true,
  "env": { "EXPO_PUBLIC_API_URL": "https://<your-real-prod-domain>/api/v1" }
}
```

## 3. Performance & UI/UX — FIXED

- **CRITICAL — light-theme invisible checkmark (fixed):** `MovieRow.tsx` and `ShowRow.tsx`'s animated watched-checkmark circle used `c.edgeLight` for its unselected border. In the light theme (`lib/theme.ts:131`) `edgeLight` resolves to `rgba(255,255,255,0.95)` — near-solid white — invisible against the row's own light background. `edgeLight` is a glass-surface rim-light token (correctly used elsewhere in `GlassSurface.tsx`/`LiquidTabBar.tsx`), not a general-purpose border color. Fixed by switching both to `c.hairline`, the theme's properly-contrasting border token (dark+subtle in light mode, light+subtle in dark mode). A visually similar `c.edgeLight` usage in `discover.tsx`'s segmented control was investigated and left alone — it's documented as intentional, since that control floats over a photo backdrop, not the plain app background.
- **Hardcoded colors:** global grep found no invisible/inconsistent hardcoded colors — every remaining hardcoded white/`rgba(255,255,255,...)` instance is a documented "photo-caption overlay" exception (badges/text painted directly on TMDB poster/backdrop images, where legibility must not depend on the app's light/dark theme, per the codebase's own established convention). No changes made there — converting them to theme tokens would itself introduce a regression.
- **FlashList `estimatedItemSize`:** every `FlashList` instance across the app already sets it, tuned to each row's actual measured height. No warnings expected.
- **Pressable → PressableScale (premium feel):** converted 12 remaining plain `Pressable`s with manual `pressed`-opacity styling to `PressableScale` for consistent tactile feedback: the primary submit buttons on `login.tsx`, `register.tsx`, and all three steps of `forgot-password.tsx`; the logout button on `settings.tsx`; list rows and back buttons on `search.tsx`, `profile/shows.tsx`, `profile/movies.tsx`; the whole-card `ContinueWatchingCard.tsx` and `SeasonCard.tsx`; the cast-voting row in `MVPVotingSheet.tsx`; and the reaction chips in `EmotionPicker.tsx`. Removed the now-redundant manual `xPressed: { opacity: ... }` styles and unused `Pressable` imports in each file. Left `CascadeModal.tsx`'s full-screen backdrop-dismiss `Pressable` untouched — that one is correctly a plain dismiss target, not a button.
- **`app.json`:** bundle IDs are correctly and consistently `com.watchtracker.app` for both iOS and Android. All referenced assets (`icon.png`, `splash-icon.png`, `adaptive-icon.png`, `favicon.png`) exist on disk. No changes needed.

## 4. Quick UI & Layout Diagnostics — PASS (one screen improved)

- **SafeArea:** 22 of 26 screens under `app/` already use `SafeAreaView`/`useSafeAreaInsets`. Of the remaining 4: `_layout.tsx` and `(tabs)/_layout.tsx` are navigator wrappers (no direct content, correctly excluded); `(tabs)/upcoming.tsx` is an intentional retired redirect stub (renders nothing); `loading.tsx` had a centered spinner screen with low real clipping risk but was upgraded to `SafeAreaView` anyway for full consistency with the rest of the app.
- **KeyboardAvoidingView:** `login.tsx`, `register.tsx`, and `forgot-password.tsx` already correctly wrap their inputs in `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` (Android relies on `adjustResize`, the standard RN pattern). No changes needed.
- **Title overflow:** every media card/row component (`ShowRow`, `MovieRow`, `EpisodeRow`, `ShowPosterCard`, `MoviePosterCard`, `ContinueWatchingCard`, `HistoryRow`, `HorizontalMediaList`) already applies `numberOfLines` to TMDB-sourced (unbounded-length) title text. The one title `Text` without it (`HorizontalMediaList`'s section header, e.g. "Trending Now") is an app-controlled short string, not user/TMDB content — no real overflow risk.

## Files modified this pass

**Bug fix:**
- `client-mobile/components/MovieRow.tsx`, `client-mobile/components/ShowRow.tsx` — light-mode invisible checkmark border fix (`c.edgeLight` → `c.hairline`)

**PressableScale conversions:**
- `client-mobile/app/login.tsx`, `register.tsx`, `forgot-password.tsx`, `settings.tsx`, `search.tsx`, `profile/shows.tsx`, `profile/movies.tsx`
- `client-mobile/components/ContinueWatchingCard.tsx`, `SeasonCard.tsx`, `MVPVotingSheet.tsx`, `EmotionPicker.tsx`

**SafeArea consistency:**
- `client-mobile/app/loading.tsx`

## 5. Feature additions requested mid-audit — DONE

### Language filter (Profile > My Shows & My Movies)

**Premise check — the request assumed `original_language` already existed on `ShowCache`/`MovieCache` and just needed a UI. It didn't exist on either model** (and the show model is actually named `CachedShow`, not `ShowCache`). Added end-to-end rather than stopping:

- **Backend:** new `original_language` field (`CharField(max_length=8, blank=True)`) on `CachedShow` and `MovieCache` (`backend/core/models.py`), migration `core/migrations/0008_add_original_language.py` (applied to the dev DB — `manage.py check` and `makemigrations --check` both clean afterward). Populated from TMDB's `original_language` in `TMDBService.get_show_details()`/`get_movie_details()` (`backend/core/services.py` — confirmed via grep these are the *only* two places that ever write these models, so no other sync path needed updating). Exposed through `CachedShowSerializer`/`MovieCacheSerializer`; the watchlist serializers pick it up automatically since they nest those. **Existing cached rows show blank language until their next TMDB refresh** — expected and non-breaking, same as any newly-added cached field.
- **Frontend:** `original_language: string` added to the `Show`/`MovieEntry` types; one shared `selectedLanguage: string | null` + `setLanguageFilter()` added to `watchStore.ts` (persisted, mirrors the existing `preferredLayout` pattern) — a single filter shared across both screens, per the request. New `client-mobile/components/LanguageFilterModal.tsx` — a lightweight `Modal` + list (not a heavy animated bottom sheet, to keep scope proportional), with an ISO 639-1 → display-name lookup that falls back to the raw code for anything unmapped. Triggered by a "Language" pill appended to each screen's existing status-filter pill row.
- **Filtering is 100% client-side** against the already-fetched watchlist/movie cache (`e.show.original_language === selectedLanguage`) — no new API request, satisfying the "instant/offline-fast" requirement exactly. The language *options* shown are the distinct codes actually present in the user's own loaded watchlist, not TMDB's full language list.
- Fixed a small correctness gap this introduced: both screens' "empty state" copy previously assumed the only way to be empty on the `ALL` filter was a genuinely empty watchlist ("Start tracking shows from Discover"); now correctly falls back to "No shows/movies match this filter" when a language filter is what's producing zero results.

### Analytics back button

`client-mobile/app/analytics.tsx`'s header had no back button at all — confirmed by reading the file, not assumed. Added a `PressableScale` + `ArrowLeft` + `router.back()`, matching `achievements.tsx`'s exact treatment (its closest sibling — same "pushed from Profile hub" screen shape), rather than `settings.tsx`'s circular-glass-background variant which belongs to a differently-shaped header.

### Verification

- `docker exec watchtracker_backend python manage.py check` → clean.
- `docker exec watchtracker_backend python manage.py makemigrations core --check --dry-run` → "No changes detected."
- `npx tsc --noEmit` (full client-mobile project): produced only **pre-existing baseline errors**, none touching any file changed in this pass. Every error falls into one of four known, already-documented categories: (1) `@shopify/flash-list` v2's TS types no longer declaring `estimatedItemSize` even though it still works at runtime (the version-mismatch item already flagged in `PROJECT_STATUS.md`/`AUDIT.md`); (2) the SDK-57 `@expo/ui` widget files' prop types not matching this SDK-54 project (same parked issue as the widget Android-autolinking exclusion, Phase 28); (3) one pre-existing test file (`__tests__/watchStore.test.ts`) referencing a property that doesn't exist; (4) one pre-existing `HeroCarousel.tsx` ref-nullability mismatch. None reference `MovieRow.tsx`, `ShowRow.tsx`, `LanguageFilterModal.tsx`, `analytics.tsx`, `watchStore.ts`'s new fields, or any of the 12 `PressableScale` conversions.
- Not run this pass (no device/emulator attached to this session): a manual on-device smoke test of the language filter UI and the new Analytics back button. Recommend verifying both once you're back on the dev-client APK.

## Remaining blocker before a real production ship

Set `EXPO_PUBLIC_API_URL` in `client-mobile/eas.json`'s `production` build profile once a production backend domain exists — see §2. Everything else in this pass, including both feature additions above, is resolved.

## Update — 2026-07-20, Render deployment pass

A production backend is now actually being deployed (to Render), so the blocker above is being closed rather than deferred further. `client-mobile/eas.json`'s `preview` and `production` profiles both now have an `env.EXPO_PUBLIC_API_URL` placeholder (`https://REPLACE-WITH-YOUR-RENDER-URL.onrender.com/api/v1`) — swap in the real Render service URL once it exists, then rebuild (this value bakes in at build time). `preview` also now sets `"android": {"buildType": "apk"}` so that profile produces a directly installable `.apk` instead of an `.aab`.

Three additional gaps specific to deploying *this app* on Render (not covered by the §1 security pass, which assumed a generic host) were found and fixed — see `AUDIT.md`'s "Final Pre-Deployment Sweep + Render Deployment Readiness" entry for full detail: `whitenoise` wired into `MIDDLEWARE`/`STORAGES` (admin panel was unstyled otherwise), `SECURE_PROXY_SSL_HEADER` added (`SECURE_SSL_REDIRECT` would have redirect-looped every request behind Render's proxy otherwise), and a new `backend/render-start.sh` so Celery worker + beat can run alongside gunicorn on one free Render instance (Render's free tier doesn't cover Background Workers). A full step-by-step Render + EAS guide was given directly to the user for the remaining manual steps (GitHub push, Render service creation, Postgres/Redis provisioning, EAS build).
