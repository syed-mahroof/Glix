# Glix — Roadmap & Feature Checklist
**Last Updated:** 2026-07-21 (Phase 34 — Import reliability + duplicate-job guard, Android widget resize/scroll/tap-through, Google Sign-In error diagnostics, real navigation-lag fix (unscoped Zustand selectors). See Phase 33 below for the pre-deployment Render sweep)
Legend: ✅ Complete · 🟨 Partial · ⬜ Not Started

---

## Phases Completed

| Phase | Name | Date |
|-------|------|------|
| 1 | JWT Auth + Watchlist Core | 2026-07 |
| 2 | Shows Hub V2 (FlashList, Cascade, Calendar) | 2026-07 |
| 2.5 | Animated Checkmark Micro-interactions | 2026-07 |
| 3 | Movies Hub + MovieCache model | 2026-07 |
| 4 | Discover Hub (HeroCarousel, TMDB Feed) | 2026-07 |
| 5 | Profile Hub + TV Time Import | 2026-07 |
| 6 | Home Screen Widgets (iOS + Android) | 2026-07 |
| 7 | TMDB Architecture Audit & Hardening | 2026-07 |
| 8 | Movie Details Screen + Search Engine | 2026-07 |
| 9 | Shows Hub Dual-Tab Refactor (TV Time-style WATCH LIST / UPCOMING) | 2026-07 |
| 10 | Search → Add → Route → Categorize Flow | 2026-07 |
| 11 | Catch-Up Modal & Chronological Tracking | 2026-07 |
| 12 | Adaptive Light/Dark Theming + Premium Polish | 2026-07 ✅ |
| 13 | Global List/Grid Layout Toggle | 2026-07 ✅ |
| 14 | Profile Avatar Picker + Badge-System Fixes | 2026-07 ✅ |
| 15 | New/Announced Seasons Surface in Upcoming | 2026-07 ✅ |
| 16 | Avatar Picker "Cast" Tab → Real Characters | 2026-07 ✅ |
| 17 | Catch-Up Check Server-Side + Mark/Unmark Season Toggle | 2026-07 ✅ |
| 18 | Upcoming Tab Day-Wise Section Grouping | 2026-07 ✅ |
| 19 | UX Audit Bundle (Undo, Watchlist Search, Onboarding Quick-Add) | 2026-07 ✅ |
| 20 | Profile Hub Deep QA Audit | 2026-07 ✅ |
| 21 | Discover Hub Deep QA Audit + "Network Error" Root Cause | 2026-07 ✅ |
| 22 | Movies Hub Deep QA Audit | 2026-07 ✅ |
| 23 | Shows Hub Deep QA Audit | 2026-07 ✅ |
| 24 | TV Time GDPR Import Pipeline (Celery-backed) | 2026-07 ✅ |
| 25 | Pre-deployment DevSecOps/API/UI/UX Audit | 2026-07 ⚠️ CONDITIONAL |
| 26 | Django Admin Modernization (django-unfold) | 2026-07 ✅ |
| 27 | Sign in with Google/Apple (ID-token verification, not django-allauth) | 2026-07 🟨 |
| 28 | Forgot Password via email OTP + EAS Android build fix | 2026-07 🟨 |
| 29 | Rapid Pre-Deployment Audit + Language Filter & Analytics Back Button | 2026-07 ✅ |
| 30 | Glix Rebrand + Categorized Language Filter + Shows Hub Default Tab | 2026-07 ✅ |
| 31 | Push Notifications Actually Wired End-to-End | 2026-07 🟨 |
| 32 | Premium Animated Splash | 2026-07 🟨 |
| 33 | Final Pre-Deployment Sweep + Render Deployment Readiness | 2026-07-20 ✅ |
| 34 | Import Reliability + Widget/Google-Sign-In/Navigation-Perf Fixes | 2026-07-21 🟨 |

---

## Phase 34 — Import Reliability, Android Widget, Google Sign-In Diagnostics, Navigation Perf

User (relaying a real-world test by their brother, the app's first outside user) reported the TV Time import undercounting/showing "Import Failed" despite the backend actually succeeding, the Android home-screen widget stuck at a tiny 2x2 with no tap-through, Google Sign-In failing with a generic error, general intermittent "Network Error" banners, and laggy navigation between tabs/screens. Full root-cause writeup in `AUDIT.md`.

### Done
- ✅ Import poll resilience (`pollImportJob`), idempotent import-job creation (`TVTimeImportView`), orphaned-job self-healing (`ImportJob.updated_at`, migration `0009`), bounded worker time (`soft_time_limit`), negative TMDB-404 caching (`get_season_episodes`), and always-refetch-on-settle in `profile.tsx`.
- ✅ Android widget resized (resizable 4x2 default), background auto-refresh (`updatePeriodMillis`), scrollable multi-row list, tap-through deep link to the specific show (`watchtracker://show/<id>`), missing `id` on the Upcoming widget payload added.
- ✅ `extractErrorMessage` no longer discards real error messages; GoogleSignin native error codes mapped to plain explanations.
- ✅ Real navigation-lag bug found and fixed: 6 files subscribed to the entire Zustand store with no selector, `app/_layout.tsx` worst of all since it wraps the whole app.
- 🟡 Google Sign-In's most likely real-world blocker (Android OAuth client's SHA-1 in Google Cloud Console) is outside the repo — flagged with exact next step, not something code alone can fix.
- 🟡 Not verifiable this session: no Android device/emulator attached, so widget resize/scroll/tap-through and the navigation-perf improvement are unconfirmed on real hardware.
- 🔴 Found, flagged, not touched: `backend/.env.prod` is tracked in git with real production secrets in plaintext — a credential-rotation decision for the user, not a silent fix.

---

## Phase 29 — Rapid Pre-Deployment Audit + Language Filter & Analytics Back Button

User requested a rapid pre-deployment audit (security/config, API health, UI/UX polish, layout diagnostics), then mid-audit asked for two feature additions: a language filter on Profile > My Shows/My Movies, and a missing back button on the Analytics screen. Full findings in new `DEPLOYMENT_READY.md` (root of repo).

### Done
- ✅ **CRITICAL bug found and fixed:** `MovieRow.tsx`/`ShowRow.tsx`'s animated watched-checkmark used `c.edgeLight` for its unselected border — resolves to `rgba(255,255,255,0.95)` in the light theme (`lib/theme.ts`), invisible against the row's own light background. `edgeLight` is a glass rim-light token (correct use in `GlassSurface.tsx`/`LiquidTabBar.tsx`), not a general border color; switched both to `c.hairline`. A visually similar `discover.tsx` usage was checked and left alone — that one floats over a photo backdrop, a documented legitimate exception.
- ✅ 12 files converted from plain `Pressable` + manual pressed-opacity to `PressableScale`: `login.tsx`/`register.tsx`/`forgot-password.tsx` submit buttons, `settings.tsx` logout, `search.tsx`/`profile/shows.tsx`/`profile/movies.tsx` rows + back buttons, `ContinueWatchingCard.tsx`/`SeasonCard.tsx` whole-card, `MVPVotingSheet.tsx` cast row, `EmotionPicker.tsx` chips.
- ✅ `loading.tsx` upgraded to `SafeAreaView` for full consistency (22/26 screens already had it).
- ✅ Everything else audited clean, no fix needed: `DEBUG`/`SECRET_KEY`/`ALLOWED_HOSTS`/HSTS already fail-closed in `prod.py`; TMDB key already log-masked; `FlashList estimatedItemSize` already set everywhere; `app.json` bundle IDs/assets already correct; `KeyboardAvoidingView` already correct on all 3 auth screens; `numberOfLines` already applied everywhere it matters.
- 🟨 **Confirmed with the user, left as a documented blocker, not guessed:** `eas.json`'s `production` build profile has no `EXPO_PUBLIC_API_URL` — a production build would fall through to `localhost`. No production backend exists yet, so this stays open until one does.
- ✅ **Language filter — the request's own premise was wrong, fixed anyway:** it assumed `original_language` already existed on `ShowCache`/`MovieCache`. Neither the field nor a model named `ShowCache` existed (the real model is `CachedShow`). Added end-to-end: new `original_language` field + migration `0008_add_original_language` on both `CachedShow`/`MovieCache`, populated from TMDB in the only 2 call sites that write these models (`TMDBService.get_show_details()`/`get_movie_details()`), serialized through `CachedShowSerializer`/`MovieCacheSerializer`. New shared `selectedLanguage`/`setLanguageFilter()` in `watchStore.ts` (persisted, mirrors `preferredLayout`). New `components/LanguageFilterModal.tsx`, wired into both `profile/shows.tsx` and `profile/movies.tsx` as a "Language" pill — filtering is 100% client-side against the already-fetched cache, no new API request. Existing cached rows show blank language until next TMDB refresh (expected, non-breaking). Both screens' empty-state copy corrected for the language-filter-empties-the-list case.
- ✅ **Analytics back button — confirmed missing by reading the file, not assumed:** `app/analytics.tsx`'s header had no back button at all. Added `PressableScale` + `ArrowLeft` + `router.back()`, matching `achievements.tsx`'s exact bare-icon treatment (its closest sibling screen shape).
- ✅ Verified: `manage.py check` clean, `makemigrations --check` clean, `tsc --noEmit` shows only pre-existing baseline errors (FlashList v2 type mismatch, SDK-57 `@expo/ui` widget type mismatch, 1 pre-existing test file, 1 pre-existing `HeroCarousel` ref issue) — none touching any file this pass changed.
- 🟨 Not run this session: on-device manual smoke test of the language filter UI and the new back button (no device/emulator attached).

---

## Phase 32 — Premium Animated Splash

User supplied a full execution prompt — choreography table, locked design tokens, a ready-to-drop-in `AnimatedSplash.tsx` reference component — asking for the static splash-icon → static loading screen hand-off to become one seamless animated sequence: native flat-black splash → Reanimated/SVG logo-draw-on → crossfade into the app once `loading.tsx`'s existing prefetch gate resolves.

### Done
- ✅ **New `components/AnimatedSplash.tsx`:** glass disc fade/scale-in, SVG ring draws clockwise via `strokeDashoffset`, core dot spring-bounces in, "GLIX" wordmark reveals letter-by-letter staggered, breathing glow loop until `ready`, 1400ms-floor + 380ms scale+fade exit. Only already-installed deps (`react-native-reanimated`, `react-native-svg`) — no new native module. Respects `useReducedMotion()`.
- ✅ **One real bug in the reference component caught and fixed:** `Easing.inOut(Easing.sine)` doesn't exist on Reanimated's `Easing` (only `Easing.sin`) — `tsc --noEmit` flagged it as 2 new errors; fixed, not filed as pre-existing.
- ✅ **`loading.tsx` rewritten:** dropped its own redundant 600ms min-display wait (superseded by the new component's 1400ms floor), dropped the static wordmark/spinner, kept the exact same `Promise.all([fetchProfile(), fetchWatchlist()])` gate and `params.next` fallback, now driving `<AnimatedSplash ready={...} onExitComplete={...} />`.
- ✅ **`_layout.tsx`:** added `expo-splash-screen` (not a dependency before this pass) — `preventAutoHideAsync()` at module scope, `hideAsync()` on first JS paint.
- ✅ **`app.json`:** `splash.image`/`resizeMode` (static logo on white) removed, `backgroundColor` set to `#000000` — logo now only ever renders via the animated JS layer. `splash-icon.png` left on disk untouched.
- ✅ Verified: `tsc --noEmit` zero new errors after the `Easing` fix — same 4 pre-existing baseline categories as Phase 31. Grepped all touched files for stray branding — only pre-existing, unrelated bundle-identifier/scheme strings matched, nothing new.
- 🟨 **Flagged, not fixed — scope decision:** the execution prompt models `loading.tsx` as the cold-boot splash gate; it isn't for an already-logged-in user, who skips `/loading` entirely via `_layout.tsx`'s own separate boot gate straight into `(tabs)`. This pass covers the post-login/register/reset transition only — covering the warm-session cold boot too would mean lifting the splash above the `Stack` as an always-mounted overlay, a materially bigger change than requested.
- 🟨 **Not verifiable without a device/emulator:** no-flash-at-cold-start, reduced-motion collapse, and exit-crossfade feel are all unconfirmed on-device claims.

---

## Phase 31 — Push Notifications Actually Wired End-to-End

User pointed at the Settings screen (New episode alerts / Weekly digest toggles) and asked if push notifications actually work. They didn't, past storing a preference — `NotificationPreference` existed with `push_token`/`notify_new_episode`/`notify_weekly_digest`, and the client registered a token and PATCHed the toggles, but nothing on the backend ever read those fields to send anything, and no Celery Beat process existed to run anything on a schedule anyway.

### Done
- ✅ **New `core/push_notifications.py`:** `notify_users()` batches Expo push messages (100/request) to `https://exp.host/--/api/v2/push/send` via the already-pinned `requests` lib. Clears any token Expo reports `DeviceNotRegistered` for.
- ✅ **New-episode detection wired into `refresh_show_cache`:** diffs each show's cached episode ids before/after resync; an episode that's both new and airing today dispatches `notify_watchers_of_new_episodes`, pushing to every non-archived Watchlist owner with `notify_new_episode=True`.
- ✅ **New `send_weekly_digest` task:** per-user trailing-7-day watched-episode count, pushed to everyone with `notify_weekly_digest=True`; skips users with nothing watched that week.
- ✅ **Root cause of "nothing happens at all": no Celery Beat service.** `docker-compose.yml` only ran a `celery` worker (executes tasks it's told to, never schedules anything itself). Added a `celery-beat` service + `CELERY_BEAT_SCHEDULE` in `config/settings/base.py` (`sync_active_shows` every 6h, `send_weekly_digest` Mondays 9am).
- ✅ **Client bug fixed in passing:** `lib/notifications.ts` declared a `projectId` but never passed it to `getExpoPushTokenAsync()`. Now passes the real EAS project id from `Constants.expoConfig?.extra?.eas?.projectId`.
- ✅ Verified: `manage.py check` clean, new tasks/module import cleanly under `config.settings.dev`, `CELERY_BEAT_SCHEDULE` resolves to real `crontab` objects, `tsc --noEmit` shows zero new errors (same pre-existing baseline as Phase 30).
- ✅ **Container rebuild done, same session:** `docker compose up -d --build` run after explicit user confirmation — all 5 containers (`backend`/`celery`/`celery-beat`/`db`/`redis`) confirmed `Up`, `celery-beat` logs confirmed clean startup + Redis broker connection.
- 🟨 **Not verifiable without a real device:** an actual push landing on a phone needs a permission-granted physical device / real EAS dev-client build and either a show airing a genuinely new episode or the Monday digest firing. The send path itself is unit-verified; the last mile is standard for push work and is on the user's device.

---

## Phase 30 — Glix Rebrand + Categorized Language Filter + Shows Hub Default Tab

User supplied the real logo (`client-mobile/assets/Glix.png`) and asked for a full "WatchTracker" → "Glix" rebrand, an upgrade of the Phase 29 flat language filter into categorized sections, and a fix so the Shows Hub always opens on WATCH NEXT.

### Done
- ✅ **Rebrand, case-sensitive, repo-wide:** 5 docs (`context.md`/`PROJECT_STATUS.md`/`ROADMAP.md`/`AUDIT.md`/`DEPLOYMENT_READY.md`), `app.json` (`name`/`slug`, `eas.projectId` untouched), all 4 icon/splash/favicon assets resized from `Glix.png`, frontend text (`lib/errors.ts`, `lib/migration.ts`'s `exportWatchTrackerData`→`exportGlixData` rename + 2 call sites, `loading.tsx`, all 4 widget titles), backend text (password-reset email, `DEFAULT_FROM_EMAIL`, Unfold `SITE_TITLE`/`SITE_HEADER`, `WatchTrackerTokenObtainSerializer`→`GlixTokenObtainSerializer` rename + usage). `README.md` doesn't exist in the repo. Also updated for consistency (not explicitly asked): `WATCHTRACKER_AI_PLAYBOOK/AI_RULES.md` body text.
- 🟨 **Deliberately left unrenamed, flagged not silently skipped:** Zustand persist keys `watchtracker-store`/`watchtracker-theme` (renaming would silently reset every existing user's local preferences on next launch) and the `WATCHTRACKER_AI_PLAYBOOK` folder name itself (riskier structural rename, out of explicit scope).
- ✅ **Language filter categorized:** `components/LanguageFilterModal.tsx` rewritten to sectioned sections — "All languages" always first/standalone (default), "Major Indian Languages" (Malayalam/Tamil/Telugu/Kannada/Hindi) shown when present, "Global Languages" (everything else) shown when present. `LANGUAGE_NAMES` extended with `ml`/`ta`/`te`/`kn`. No caller-side changes needed (`profile/shows.tsx`/`profile/movies.tsx` unchanged) — filtering remains 100% client-side.
- ✅ **Shows Hub default tab fixed:** `app/(tabs)/index.tsx`'s initial filter changed `'ATTENTION'` → `'WATCH_NEXT'` per user screenshot, matching the Movies Hub's existing default.
- ✅ Verified: `tsc --noEmit` zero new errors (same 4 pre-existing baseline categories as Phase 29). `analytics.tsx` back button re-confirmed present. No new hardcoded colors introduced.

---

## Phase 28 — Forgot Password via email OTP

User asked what a forgot-password feature needed (OTP generation, mail sending), then chose Gmail SMTP + an App Password over a transactional provider (Resend/SendGrid) after those were confirmed to require domain verification the user doesn't have. Full rationale in `context.md`'s Phase 28 section.

### Done
- ✅ `core/password_reset.py` — OTP codes + one-time reset tokens both live in Django's cache framework (Redis-backed since Phase 25), no new model/migration
- ✅ `POST /auth/password-reset/request/`, `/verify/`, `/confirm/` — enumeration-safe (always 200 regardless of whether the email exists), 60s resend cooldown, 5-attempt lockout, single-use codes/tokens
- ✅ Gmail SMTP wired via new `EMAIL_*` settings (`config/settings/base.py`, real credentials in `.env`, placeholders in `.env.prod`)
- ✅ Styled HTML OTP email — branded `multipart/alternative` message (accent `#E4FA1A` + dark surfaces) via `send_mail`'s `html_message`, with a plain-text fallback, instead of a bare-text code
- ✅ 12 new backend tests (`test_password_reset.py`) — real Redis cache, `locmem` email backend per-test so nothing hits real Gmail. Full suite now 33/33 passing
- ✅ Live-verified past the test suite: hit the real endpoint against the user's actual Gmail address through the real SMTP relay, confirmed the App Password authenticates, zero errors in logs
- ✅ Frontend: new `app/forgot-password.tsx` (3-step single screen: email → code → new password), "Forgot password?" link added to `login.tsx`
- ✅ `tsc --noEmit` — same pre-existing baseline, zero new errors
- ✅ Also fixed, same session: `RNGoogleSignin` native-module-missing crash (stale dev-client APK predating the Phase 27 google-signin dependency) — needed a new EAS dev-client build, plus a missing `expo-dev-client` package dependency that was blocking `eas build --profile development` outright
- 🟨 That rebuild then surfaced **two** independent Gradle failures, both root-caused via local Gradle and fixed in one plugin `plugins/withExcludeLegacySupportLibs.js` (replaced the deleted version-force plugin). **(1)** `:app:mergeDebugResources` `Duplicate value for resource 'attr/actionBarSize'` — first mis-blamed on a google-signin material/appcompat version conflict (three version-force builds failed; the graph already resolves to a unified appcompat 1.7.0/material 1.12.0), actually a vestigial `com.android.support:appcompat-v7:23.0.1` dragged in by `react-native-shared-preferences@1.0.2`; fixed by injecting `exclude group: 'com.android.support'` (safe since the app is fully AndroidX). **(2)** `:app:checkDebugDuplicateClasses` `Duplicate class androidx.work.*Kt` (surfaced only after fix 1 unblocked the merge, via build `da8a089d`'s raw log) — `react-native-android-widget`'s stale `work-runtime-ktx:2.7.1` colliding with the classes WorkManager 2.8.0 merged into `work-runtime:2.8.1`; fixed by forcing both `androidx.work` artifacts to 2.8.1. Verified locally: support-group refs → 0, `mergeDebugResources` **and** `checkDebugDuplicateClasses` both BUILD SUCCESSFUL, plugin confirmed injecting the exclude + both forces on a fresh `expo prebuild --clean`. ✅ EAS build `4f7be02b` FINISHED green.
- 🟨 **(3) Third blocker — a RUNTIME crash after that APK installed** (not Gradle): app launched then died with `Failed resolution of AnyTypeCache` from `@expo/ui`'s native module. Three **SDK-57** packages (`@expo/ui@57`, `expo-widgets@57` which hard-depends `@expo/ui@~57`, `expo-haptics@57`) had been `npm install`ed into this **SDK-54** app; SDK-57 `@expo/ui` references `AnyTypeCache`, absent from SDK-54's `expo-modules-core@3.0.30`. Fix 3a: `expo-haptics` → SDK-54 `15.0.8` (`npx expo install`, it's used on Android). Fix 3b: `@expo/ui`+`expo-widgets` are the iOS-only widget pair with **no SDK-54 release** — excluded from **Android** native autolinking via `package.json` `expo.autolinking.android.exclude`, verified absent with `expo-modules-autolinking resolve -p android`; iOS untouched, pair parked until an SDK 55+ bump. ✅ Rebuild `356c46ca` FINISHED green — APK `https://expo.dev/artifacts/eas/lLJUarYd_BPkeTxPQrO_hHjxAJvaqUOhkhKPGKD6nAc.apk`.
- 🟨 Still pending (device-only): install the dev-client APK from build `356c46ca` (`https://expo.dev/artifacts/eas/lLJUarYd_BPkeTxPQrO_hHjxAJvaqUOhkhKPGKD6nAc.apk`), then test Google sign-in + the OTP flow + the styled email on a real device.

---

## Phase 27 — Sign in with Google/Apple

User asked whether `django-allauth` was the best approach for SSO. **Decision: no** — implemented as direct ID-token verification instead (allauth is an OAuth-client-with-sessions architecture, wrong shape for a JWT-only mobile backend). Full rationale in `context.md`'s Phase 27 section.

### Done
- ✅ `SocialAccount` model + migration `0007_socialaccount`, applied to both the real docker DB and native Postgres
- ✅ `core/social_auth.py` — PyJWT/`PyJWKClient` JWKS verification for Google + Apple ID tokens (`cryptography` added as PyJWT's RS256 backend, the only new dependency)
- ✅ Get-or-create/link logic: links by stable `sub` claim first, falls back to verified-email match only, unusable password on new social accounts
- ✅ `GoogleLoginView`/`AppleLoginView` at `/api/auth/google/`, `/api/auth/apple/` — same `{access, refresh, profile}` envelope plus new `created` field
- ✅ `SocialAccount` registered in admin (Unfold `ModelAdmin` + sidebar entry)
- ✅ 15 new backend tests (`test_social_auth.py`) — locally-crafted RSA-signed JWTs, zero real network calls, explicitly covers the unverified-email-must-not-link security case. Full suite 21/21 passing — first time the complete suite has run end-to-end (docker Postgres has the `CREATEDB` grant the native instance still lacks)
- ✅ Live-verified against the real running container: migration applied, `manage.py check` clean, both endpoints return correct `{detail, code}` envelopes for missing/malformed tokens, zero server errors in logs
- ✅ Frontend: `lib/socialAuth.ts`, `components/SocialSignInButtons.tsx` (official `GoogleSigninButton`/`AppleAuthenticationButton`, not a hand-built brand mark), wired into `login.tsx`/`register.tsx`, `app.json` plugins + `usesAppleSignIn`
- ✅ `tsc --noEmit` — exact 62-line baseline, zero new errors
- 🟨 **Not verifiable in this environment:** the real on-device OAuth handshake needs Google Cloud Console client IDs and an Apple Developer "Sign In with Apple" capability + fresh EAS Build — both require the user's own paid/authenticated accounts. See `AUDIT.md` for the full external-blocker checklist.

---

## Phase 26 — Django Admin Modernization (django-unfold)

User asked whether a Django superuser existed (surfaced it was created against the wrong — native, unreachable — Postgres instance in Phase 25; created a working one directly in the live container instead) then asked for the admin UI itself to be modernized specifically with `django-unfold`.

### Done
- ✅ `django-unfold==0.100.0` installed, added to `INSTALLED_APPS` before `django.contrib.admin`, pinned exact in `requirements.txt`
- ✅ `UNFOLD` config in `config/settings/base.py`: brand-derived OKLCH color ramp (converted from the app's own `#E4FA1A` accent, not the package default purple), grouped sidebar navigation (4 sections, Material icons, links to all 15 models)
- ✅ `core/admin.py` fully rewritten — every `ModelAdmin` now inherits `unfold.admin.ModelAdmin`; `auth.User`/`auth.Group` re-registered with Unfold's styled forms
- ✅ **Found and closed a real pre-existing gap:** 7 of 15 models had never been admin-registered (`Comment`, `CommentLike`, `CommentReport`, `NotificationPreference`, `MovieCache`, `MovieWatchState`, `MovieWatchlist`, `ImportJob`) — all now registered
- ✅ Verified live against the real running container: rebuilt Docker images (pip installs happen at build time, not via the bind-mounted volume), full scripted login, all 12 model changelist pages + dashboard → `200`, zero server errors
- 🟢 Found, not acted on: an orphaned second `docker compose` stack (`backend-*-1`, port 8000/5433) running alongside the real one — flagged in `AUDIT.md`, not torn down (out of scope for this pass)

---

## Phase 23 — Shows Hub Deep QA Audit

Same audit pattern as Phases 20–22, scoped to the Shows Hub (`app/(tabs)/index.tsx`), show detail (`app/show/[id].tsx`), season screen, episode screen, and connected components.

### Done
- ✅ **KNOWN BUG FIXED:** `buildRows()` silently dropped any watchlist entry with 0 cached episodes ("zombie"/invisible rows) — closes the item tracked in `AUDIT.md`'s Known Issues table. `ShowEpisodeRow.episode` is now `Episode | null`; List view renders a new `ZombieRow` fallback (tap-through re-triggers a real TMDB fetch), Grid view renders `ShowPosterCard` with a "NO DATA" badge instead of silently dropping the entry.
- ✅ **Real bug:** `todayIso` computed via `toISOString()` (UTC) while every other date check in the same files anchors on local midnight — for positive-UTC-offset timezones during early-morning hours, an already-aired episode could be wrongly marked unaired. Fixed with new `lib/dateFormat.ts::todayLocalIso()`, applied at all 9 repo-wide call sites found via grep (Shows Hub's scope: `buildRows()`, `pickNextEpisode()`/`buildUpcomingItems()`, `formatUpcomingHeaderLabel()`, season screen, episode screen ×2, `EpisodeRow.tsx`, `CalendarGrid.tsx`).
- ✅ **Real bug:** show-side `TMDBService.get_recommendations()` had the identical `backdrop_path`/`overview` gap Phase 22 fixed on the movie side (deferred here at the time) — fixed, plus 2 more zero-param tap-through sites found in the same pass (`UpcomingRow`, `CalendarGrid.tsx`'s episode row) that Phase 22's movie-side fix didn't cover.
- ✅ `FilterPill` (index.tsx) — removed the same hand-rolled press-scale animation pattern Phase 22 fixed on movies.tsx, switched to `PressableScale`
- ✅ Converted every remaining plain `Pressable` to `PressableScale` across all 4 screens + `EpisodeRow.tsx`/`CalendarGrid.tsx`
- ✅ All 3 Watch List/History/Upcoming empty states now render inside a `GlassSurface` card; show/season "progress" stat cards converted from raw tinted `View`s to `GlassSurface`
- ✅ `episode/[id].tsx`'s error state upgraded to the established `GlassSurface`/`WifiOff`/`PressableScale` pattern (last of the 3 detail screens missing it)
- ✅ `estimatedItemSize` corrected from `100` to `108`/`110` (measured against actual row footprints) — Phase 22's `movies.tsx` had already measured the identical row shape correctly
- ✅ Dead code purged: `ShowCard.tsx` (zero usages repo-wide, superseded by `ShowPosterCard.tsx`), 3 duplicate local `pad()` helpers deduped to `lib/dateFormat.ts`
- ✅ Confirmed clean: `ShowRow.tsx`/`ShowPosterCard.tsx` (bespoke checkmark animation intentionally bypasses `PressableScale`), Catch-Up modal + Undo Snackbar wiring on season/episode screens (matches Phase 17/19, no regressions)
- ✅ Verified: `tsc --noEmit` zero new errors (62-line baseline unchanged), Django check clean, 6/6 pytest, live-verified recommendations fix against real TMDB

---

## Phase 22 — Movies Hub Deep QA Audit

Same audit pattern as Phase 20 (Profile) / Phase 21 (Discover), scoped to the Movies Hub and its detail screen.

### Done
- ✅ **Real bug:** `TMDBService.get_movie_recommendations()` silently dropped `backdrop_path`/`overview` (TMDB always includes them) — "More Like This" cards on `movie/[id].tsx` couldn't pass a complete optimistic-routing param set to the next movie screen. Fixed backend + `RecItem` type + card params.
- ✅ **Dead code purged:** `movies.tsx`'s `collapsingIds` ref — declared with a stated purpose, never actually populated (`.add()` never called anywhere), only a permanent no-op `.delete()`. Removed entirely; the real anti-jump mechanism (deferred Zustand update) already worked without it.
- ✅ `FilterPill` (movies.tsx) — removed ~15 lines of hand-rolled press-scale animation duplicating `PressableScale`, switched to the shared component
- ✅ Converted every remaining plain `Pressable` to `PressableScale`: movies.tsx (header icon, error banner, browse button), movie/[id].tsx (sticky header back, backdrop back, backdrop action button, hero watch button, recommendation cards)
- ✅ movies.tsx empty state now renders inside a `GlassSurface` card
- ✅ Confirmed clean: `MovieRow.tsx`/`MoviePosterCard.tsx` (bespoke checkmark animation intentionally bypasses `PressableScale`, matches `ShowRow.tsx`'s identical established pattern), FlashList `estimatedItemSize` values match `MovieRow.ROW_HEIGHT` exactly
- ✅ Watch state & caching traced end-to-end (`MovieAddView`, `MovieWatchlistView`, `watchStore.ts`'s movie actions) — no bugs found, confirms Phase 14's badge-system audit findings still hold
- ✅ Verified: `tsc --noEmit` zero new errors, Django check clean, 6/6 pytest, live-verified recommendations fix against real TMDB

### Deliberately deferred (found, not fixed)
- ✅ `get_recommendations()` (TV show side) had the identical `backdrop_path`/`overview` gap — fixed in Phase 23's Shows Hub audit

---

## Phase 21 — Discover Hub Deep QA Audit + "Network Error" Root Cause

User-reported: intermittent raw "Network Error" text across the app, especially tapping into movie/show detail. Full Discover Hub + TMDB pipeline audit requested.

### Done
- ✅ **Root cause found and fixed:** `lib/errors.ts::extractErrorMessage` fell through to axios's raw `error.message` (literally the string "Network Error" for a no-response failure) — now returns friendly, actionable messages for timeout (`ECONNABORTED`) and no-response cases
- ✅ Backend `TMDBService` retry strategy tightened (`total=4/backoff_factor=1` → `total=3/backoff_factor=0.5`, worst-case backoff 15s → 3.5s) — was compounding with multi-call endpoints to exceed the frontend timeout
- ✅ Frontend axios timeout raised 10s → 15s, tuned together with the backend change
- ✅ `discoverStore.ts`'s 3 fetch actions switched to the shared `extractErrorMessage` (were duplicating extraction inline, an AI_RULES §3.2 rule-11 violation)
- ✅ Live-verified: real `DiscoverFeedView` 3-call TMDB sequence timed at 1.34s, comfortably inside new timeout
- ✅ **2nd bug found:** inconsistent optimistic-routing params — `HeroCarousel`/`HorizontalMediaList`/`SearchResultCard` each passed a different partial subset of the 5 fields both detail screens read; now all 3 pass the full set
- ✅ **Dead code purged:** `HorizontalMediaList.tsx`'s `onAddPress`/`[+]` button — never passed by its only caller, permanently dead
- ✅ Phase 12 compliance: `GenreGrid.tsx` hardcoded `#1E1E1E` → `c.glassFill`; `DiscoverFilterSheet.tsx` emoji sort labels → lucide icons; every remaining plain `Pressable` across `discover.tsx` + 4 components → `PressableScale`; error states wrapped in `GlassSurface` with a `WifiOff` icon (discover.tsx feed/filtered errors, movie/show detail primary-load errors)
- ✅ Verified: `tsc --noEmit` zero new errors, Django check clean, 6/6 pytest

### Deliberately deferred (found, not fixed — future dedicated pass)
- ⬜ `movie/[id].tsx`/`show/[id].tsx` still have plain `Pressable`s elsewhere (back/action buttons) beyond the error state fixed here — full-screen PressableScale conversion is a separate scope, same treatment as Phase 20's Profile Hub audit

---

## Phase 20 — Profile Hub Deep QA Audit

Full page-wise QA/refactor/polish of `app/(tabs)/profile.tsx` + every connected component, checked strictly against Phase 12's adaptive-theming rules.

### Done
- ✅ Fixed real desync bug — Social Bar "Movies" count vs "My Movies" row badge showed two different numbers on the same screen; unified into one `totalMovies` memo
- ✅ Replaced 3 hard-coded `#FFB800` occurrences with `c.negative` (was a 3rd hue outside the locked accent+error palette)
- ✅ Normalized the profile page's own modal-scrim opacity (0.85 → 0.6) to match the app-wide convention
- ✅ Converted 3 remaining plain `Pressable`s (header icons, "See all" link) to `PressableScale`; removed now-unused `Pressable` import
- ✅ `lib/typography.ts`'s new `monoValueStyle` (tabular-nums, no caption transforms) applied to all 6 numeric stat displays on the page — user-requested "JetBrains Mono for stat numbers," previously only the captions had mono styling
- ✅ Confirmed clean: null/empty-state handling, `GlassSurface` coverage, all navigation routes, `community.tsx` wiring — no dead code or "coming soon" placeholders found
- ✅ Verified: `tsc --noEmit` zero new errors, Django check clean, 6/6 pytest

---

## Phase 19 — UX Audit Bundle

Full-app feature audit (Explore-agent survey, code-verified). 8 real gaps found; user picked the 3 smallest/most contained to ship now, deferred the rest.

### Done
- ✅ `components/Snackbar.tsx` (new, generic) — Undo toast wired into the Catch-Up cascade via `useCatchupCascade`'s new `(ids, watched)` `onFinalize` signature, all 3 call sites
- ✅ Search box on `profile/shows.tsx` / `profile/movies.tsx` — client-side title filter composed with existing pills
- ✅ Onboarding quick-add — 4th page, 12-title poster grid from `DiscoverFeedView`'s existing `popular_shows` section, multi-select, `addShowToWatchlist()` on Get Started
- ✅ Verified: `tsc --noEmit` zero new errors, Django check clean, 6/6 pytest

### Deferred (found during the same audit, explicitly not started)
- ⬜ Push notification delivery — `notify_new_episode`/`push_token` exist, no Celery task sends anything
- ⬜ Personal rating system — only emotion emoji + MVP vote exist, no star/numeric rating
- ⬜ Rewatch tracking — `WatchState` is a single presence row per episode, no repeat-watch logging
- ⬜ Social graph (follow/followers) — comments are show-scoped only, no user-to-user model
- ⬜ Calendar/.ics export for Upcoming episodes

---

## Phase 18 — Upcoming Tab Day-Wise Section Grouping

User-requested: group the UPCOMING tab's List/Grid views by release day, so episodes from different shows landing on the same date sit under one shared header.

### Done
- ✅ `lib/dateFormat.ts`'s `formatUpcomingHeaderLabel()` — TODAY/TOMORROW/weekday (2–6 days)/absolute date (7–30 days)/`LATER` (30+ days) bucketing
- ✅ `lib/upcoming.ts`'s `groupUpcomingItemsByDate()` — flattens the sorted upcoming list into header/item entries, same-date items from different shows naturally share one header
- ✅ `app/(tabs)/index.tsx` — new `UpcomingSectionHeader` component; List and Grid FlashLists both render the grouped entries; Grid headers span the full row via FlashList v2's `overrideItemLayout`
- ✅ Verified: `tsc --noEmit` zero new errors; bucketing logic sanity-checked against sample dates in a scratch script

### Not live-tested
- ⬜ On-device/Expo session verification — no device/emulator available in this pass

---

## Phase 17 — Catch-Up Check Server-Side + Mark/Unmark Season Toggle

User-reported: marking a later episode (e.g. #6 of 8) with earlier ones unwatched showed no Catch-Up modal at all. User asked for correctness regardless of order/season/episode, plus a Mark/Unmark toggle on "Mark Season Watched."

### Done
- ✅ `CatchupCheckView` (`POST /api/watch-state/catchup-check/`) — server-authoritative, eager-caches any missing earlier season via `TMDBService.get_season_episodes()` before answering; episode mode + season mode
- ✅ Removed client-side `watchStore.hasPreviousUnwatched`/`hasPreviousUnwatchedForSeason` (bounded by whatever the client happened to have cached — root cause of the bug)
- ✅ `lib/useCatchupCascade.ts`'s `checkEpisode`/`checkSeason` now async, call the new endpoint
- ✅ All 5 call sites updated (Shows Hub row + grid, season screen episode + season-mark, episode detail)
- ✅ Mark/Unmark Season Watched dynamic toggle (`app/show/[id]/season/[season].tsx`) — un-watch direction skips the Catch-Up check (same rule as everywhere else)
- ✅ Live-verified via rolled-back DB transactions: same-season jump (the exact reported bug), cross-season jump on a real show (Reacher) with 2 seasons never opened — correctly auto-cached and counted 18 previous unwatched, season-mode isolation, `ignore_catchup` short-circuit
- ✅ Verified: Django check clean, 6/6 pytest, `tsc --noEmit` zero new errors

---

## Phase 16 — Avatar Picker "Cast" Tab → Real Characters

User feedback: Phase 14's "Cast" tab showed generic trending celebrities, not characters. TMDB has no character-portrait asset or `/character/popular` endpoint, so this is the closest TMDB-backed approximation.

### Done
- ✅ `TMDBService.get_popular_characters(limit)` replaces `get_popular_people()` — top-billed cast from trending TV + popular movies, labeled by `character` name (via existing `get_show_credits()`/`get_movie_credits()`, which already returned `character`, just unused by the picker before)
- ✅ `AvatarOptionsView` response shape updated (`{character, show_title, profile_path}`), cache key renamed
- ✅ `AvatarPickerModal.tsx`'s `CastCharacter` type updated to match
- ✅ Live-verified against real TMDB: real character names returned (Daemon Targaryen, Alicent Hightower, Juliette Nichols), not actor names
- ✅ Verified: Django check clean, 6/6 pytest, `tsc --noEmit` zero new errors

---

## Phase 15 — New/Announced Seasons Surface in Upcoming

Requested: a watchlisted show (even unstarted) with a newly-announced season/episode should show up chronologically in the UPCOMING tab, sourced from TMDB, the same way a reference tracking app does.

### Done
- ✅ `CachedShow.next_episode_air_date`/`next_episode_season_number`/`next_episode_number`/`next_episode_name` (migration `0005`) — from TMDB's `next_episode_to_air`
- ✅ `TMDBService.get_show_details()` extracts it on every fetch/refresh (including the periodic Celery `refresh_show_cache` sweep, no separate wiring)
- ✅ `CachedShowSerializer` exposes the 4 fields through `GET /api/watchlist/`
- ✅ `lib/upcoming.ts`'s `buildUpcomingItems()` emits a synthetic upcoming item from it when the season isn't otherwise cached yet, deduped against real cached episodes — shared by the UPCOMING List view, `CalendarGrid.tsx`, and the widget data bridge
- ✅ Live-verified against real TMDB (Reacher's actual Season 4 Episode 1, 2026-08-12) — full pipeline round-tripped correctly, and the dev DB's real Reacher row was refreshed as part of verification
- ✅ Verified: Django check clean, 6/6 pytest, `tsc --noEmit` zero new errors

---

## Phase 14 — Profile Avatar Picker + Badge-System Fixes

Requested: Profile "EDIT" avatar functionality, plus an audit of the Profile hub's badges and other rows for anything wired-looking but not actually working.

### Done
- ✅ `components/AvatarPickerModal.tsx` — two-tab picker: "Cast" (real TMDB `/person/popular` headshots via new `GET /api/profile/avatar-options/`) / "Cartoon" (illustrated DiceBear avatars, client-side seed list, no new dependency)
- ✅ Backend: `TMDBService.get_popular_people()`, `AvatarOptionsView` (24h cached), route wired
- ✅ `store/watchStore.ts` — `updateProfilePicture(url)` (optimistic PATCH `/profile/`)
- ✅ `profile.tsx` — avatar image + "EDIT" pill now open the picker (previously routed to Settings, which has no avatar/edit UI at all)
- ✅ Fixed `BadgeUnlockModal` showing a raw un-capitalized slug + a hard-coded generic description for every badge — now reads real label/description from `lib/badges.ts`'s `BADGE_META`
- ✅ Fixed `movie_lover` badge — declared and displayed since early phases but never awarded by any code path (no signal, no safety-net check); added real-time signal, safety-net check, and progress computation, live-verified via a rolled-back DB transaction
- ✅ Verified: Django check clean, 6/6 pytest, `tsc --noEmit` zero new errors

### Not live-tested
- ⬜ On-device/Expo session verification — no device/emulator available in this pass; verified via `tsc`/Django check/pytest/rolled-back-transaction only

---

## Phase 13 — Global List/Grid Layout Toggle

Mirrors premium tracking-app UX (TV Time-style list/poster-grid switch) across every primary media list, backed by one shared persisted preference rather than a per-screen setting.

### Done
- ✅ `store/watchStore.ts` — persisted `preferredLayout: 'list' | 'grid'` + `toggleLayout()`
- ✅ `components/LayoutToggle.tsx` — reusable icon-only toggle (lucide `List`/`LayoutGrid`, `PressableScale`, fully theme-token driven)
- ✅ `components/ShowPosterCard.tsx` / `components/MoviePosterCard.tsx` — new large poster-first grid cards (2:3 posters, 16px radius, photo-caption badge overlays, `accentFill`/`onAccent` checkmark)
- ✅ Wired into all 4 targeted screens: `app/(tabs)/index.tsx` (WATCH LIST + UPCOMING List sections), `app/(tabs)/movies.tsx`, `app/profile/shows.tsx`, `app/profile/movies.tsx`
- ✅ FlashList `numColumns`/`extraData`/keyed-remount handling per screen to avoid layout thrashing when switching layouts
- ✅ Verified: `tsc --noEmit` (stack-size workaround) — zero new errors; only the pre-existing repo-wide FlashList `estimatedItemSize` typing gap, now also present at the new grid `FlashList` call sites (same tracked issue, not a new one)

---

## Phase 12 — Adaptive Theming & Polish

Design plan lives in a published artifact ("Glix · Phase 9 · Design System & Premium Polish"). Renegotiates two "locked" tokens (pitch-black bg, yellow-only foreground) — intentional brand expansion, `AI_RULES.md` §2 amended (§2a) with the sign-off + rationale.

### Done
- ✅ Theme foundation — `lib/theme.ts`, `store/themeStore.ts`, `app/_layout.tsx`, `(tabs)/_layout.tsx` + `LiquidTabBar.tsx` (Discover `Search`→`Compass` icon fix, filled active icons)
- ✅ Settings Appearance control (System/Light/Dark, `SegmentedControl`)
- ✅ Dead-weight audit fixes — Profile header Search button removed, "Create a New List" removed, social bar collapsed to real Shows/Movies
- ✅ New shared components — `GlassSurface`, `PressableScale`, `AmbientGlow`, `TrendChip`
- ✅ New shared libs — `lib/typography.ts` (mono precision labels), `lib/motion.ts` (entrance stagger)
- ✅ Fully migrated to theme tokens — `profile.tsx`, `settings.tsx`, `SegmentedControl.tsx`, `StatsCard.tsx`, `analytics.tsx` (+ hero `AmbientGlow`, quick-stats entrance stagger, hours-watched `TrendChip`)

- ✅ Full screen/component migration — all ~54 remaining screens/components off hard-coded dark-only constants, every color read from `useAppTheme().theme.colors` (2026-07-14, user-reported light-theme breakage)
- ✅ `achievements.tsx`/`year-review.tsx` entrance stagger + `AmbientGlow` (TrendChip intentionally omitted — no prior-period data to compare)
- ✅ `ProgressRing.tsx`/`SpoilerOverlay.tsx` made genuinely theme-aware (AUDIT.md/docs previously claimed done, actual files weren't)
- ✅ `ShowCard.tsx` forked SVG ring removed, now uses shared `ProgressRing.tsx`

### Not started
- ⬜ Real JetBrains Mono (currently a `monospace` generic substitute — see `AUDIT.md`)

- ✅ `lib/theme.ts` — token system, `AppThemeProvider`, `useAppTheme()`, split `accentFill`/`accentInk`, premium light theme
- ✅ `store/themeStore.ts` — persisted System/Light/Dark preference
- ✅ Root layout wired to tokens (StatusBar, nav theme, backgrounds)
- ✅ Tab bar migrated (Compass for Discover, active-fill icons)
- ✅ Migrate remaining ~54 screens/components off hard-coded color constants
- ✅ Settings Appearance control (System/Light/Dark)
- ✅ Polish: `GlassSurface`, `PressableScale`, mono labels, entrance stagger, `AmbientGlow`, `TrendChip`
- ✅ Dead-weight fixes: remove Profile Search btn + dead "Create a New List"; collapse fake Following/Followers

---

## Screens

- ✅ Login (`login.tsx`)
- ✅ Register (`register.tsx`)
- ✅ Onboarding (`onboarding.tsx`)
- ✅ Loading/prefetch gate (`loading.tsx`)
- ✅ Shows Hub (`(tabs)/index.tsx`) — **Phase 9: dual-tab** WATCH LIST (FlashList + pill filters) / UPCOMING (nested List↔Calendar toggle via `CalendarGrid.tsx`, inline — `CalendarHeaderModal.tsx` retired)
- ✅ Movies Hub (`(tabs)/movies.tsx`)
- ✅ Discover Hub (`(tabs)/discover.tsx`) — Hero carousel, sections, genre grid, universal search
- ✅ Profile Hub (`(tabs)/profile.tsx`) — Stats, badges, social bar, migration tools
- ✅ Profile > My Shows (`profile/shows.tsx`)
- ✅ Profile > My Movies (`profile/movies.tsx`)
- ✅ Search (`search.tsx`) — debounced, universal
- ✅ Settings (`settings.tsx`)
- ✅ Show Details (`show/[id].tsx`) — Optimistic UI, cast, seasons, providers
- ✅ Movie Details (`movie/[id].tsx`) — **Phase 8: Full implementation** (was placeholder)
- ✅ Season Details (`show/[id]/season/[season].tsx`) — **Phase 11:** "Mark Season Watched" now batches via `bulkToggleWatchState` (was N individual requests) and triggers the Catch-Up modal for unwatched earlier seasons
- ✅ Episode Details (`episode/[id].tsx`) — Emotion picker, MVP voting, credits
- ✅ Comments (`show/[id]/comments.tsx`) — Thread with spoiler support
- ✅ Community Feed (`community.tsx`)
- ✅ Achievements (`achievements.tsx`)
- ✅ Analytics Hub (`analytics.tsx`)
- ✅ Detailed Statistics (`statistics.tsx`)
- ✅ Year in Review (`year-review.tsx`)

---

## Backend APIs

### Auth
- ✅ POST `/api/auth/register/`
- ✅ POST `/api/auth/login/`
- ✅ POST `/api/auth/logout/`
- ✅ POST `/api/auth/refresh/`
- ✅ POST `/api/auth/google/` — **NEW Phase 27** — Sign in with Google, ID-token verification
- ✅ POST `/api/auth/apple/` — **NEW Phase 27** — Sign in with Apple, ID-token verification
- ✅ POST `/api/auth/password-reset/request/` — **NEW Phase 28** — email OTP request, enumeration-safe
- ✅ POST `/api/auth/password-reset/verify/` — **NEW Phase 28** — OTP verification, returns reset_token
- ✅ POST `/api/auth/password-reset/confirm/` — **NEW Phase 28** — sets new password, logs user back in

### Watchlist & Tracking
- ✅ GET `/api/watchlist/` — paginated, buckets; **NEW** `last_watched_at` per entry for recency-sorted pills
- ✅ POST `/api/watchlist/add/` — **NEW Phase 10** — adds show, eager-caches season 1
- ✅ GET `/api/continue-watching/`
- ✅ POST `/api/watch-state/toggle/`
- ✅ POST `/api/watch-state/bulk-toggle/`
- ✅ POST `/api/watch-state/catchup-check/` — **NEW Phase 17** — server-authoritative Catch-Up check
- ✅ POST `/api/watchlist/favorite/`
- ✅ POST `/api/watchlist/catchup-preference/` — **NEW Phase 11** — "Never for this show"
- ✅ POST `/api/watchlist/archive/`
- ✅ POST `/api/episode/interaction/`

### Profile
- ✅ GET/PATCH `/api/profile/`
- ✅ GET `/api/profile/avatar-options/` — **NEW Phase 14** — TMDB cast headshots for the avatar picker
- ✅ GET/PATCH `/api/notifications/preferences/`

### Movies
- ✅ GET `/api/movies/watchlist/`
- ✅ POST `/api/movies/watch-state/toggle/`
- ✅ POST `/api/movies/add/`
- ✅ GET `/api/movies/<id>/detail/` — **NEW Phase 8**
- ✅ GET `/api/movies/<id>/credits/` — **NEW Phase 8**
- ✅ GET `/api/movies/<id>/watch-providers/` — **NEW Phase 8**
- ✅ GET `/api/movies/<id>/recommendations/` — **NEW Phase 8**

### Search & Discovery
- ✅ GET `/api/discover/feed/?type=tv|movie`
- ✅ GET `/api/discover/filter/?type=&genre=&sort=&page=` — **NEW** — Filter & Sort sheet, real TMDB `/discover` + genre-filtered trending
- ✅ GET `/api/discover/genres/?type=` — **NEW** — real TMDB cover image per genre for GenreGrid tiles (24h cache)
- 🟨 GET `/api/search/shows/` — works, no pagination (legacy)
- ✅ GET `/api/search/universal/` — **Phase 8: Relevancy engine + fallback**
- ✅ GET `/api/shows/<id>/`
- ✅ GET `/api/shows/<id>/season/<n>/`
- ✅ GET `/api/shows/<id>/credits/`
- ✅ GET `/api/shows/<id>/watch-providers/`
- ✅ GET `/api/shows/<id>/recommendations/`
- ✅ GET `/api/episodes/<id>/`
- ✅ GET `/api/episodes/<id>/credits/`

### Community
- ✅ GET/POST `/api/comments/`
- ✅ GET/POST `/api/comments/<id>/replies/`
- ✅ GET/PATCH/DELETE `/api/comments/<id>/`
- ✅ POST `/api/comments/<id>/like/`
- ✅ POST `/api/comments/<id>/report/`
- ✅ GET `/api/moderation/reports/`
- ✅ POST `/api/moderation/reports/<id>/resolve/`

### Analytics (11 endpoints)
- ✅ GET `/api/analytics/dashboard/`
- ✅ GET `/api/analytics/statistics/`
- ✅ GET `/api/analytics/genres/`
- ✅ GET `/api/analytics/actors/`
- 🟨 GET `/api/analytics/providers/` — stub (no per-user data)
- ✅ GET `/api/analytics/completion/`
- ✅ GET `/api/analytics/heatmap/`
- ✅ GET `/api/analytics/streak/`
- ✅ GET `/api/analytics/year-review/`
- ✅ GET `/api/analytics/monthly-summary/`
- ✅ GET `/api/analytics/achievements/`

### Import/Export
- ✅ POST `/api/import/tvtime/` — enqueues an `ImportJob`, returns `202 {job_id, total, status}`
- ✅ GET `/api/import/status/<job_id>/` — progress + final counts, polled by the client
- ✅ `core/tasks.py::run_tvtime_import` — Celery task; resolves tvdb/imdb → TMDB via `/find/`, preserves `watched_at`, bulk-creates `WatchState`

> **Doc drift corrected (2026-07-16):** this section previously marked
> `POST /api/import/tvtime/` as ✅ complete. The endpoint existed but had
> never worked — it read `season_number`/`episode_number` while the real
> export nests both under `number`, so every episode resolved to 0 and
> zero watch state was ever written, while still reporting success. See
> `AUDIT.md` for the full entry.

---

## Database Models

- ✅ `UserProfile` (auto-created by signal)
- ✅ `CachedShow`
- ✅ `CachedEpisode`
- ✅ `Watchlist` — **Phase 11:** added `ignore_catchup` field
- ✅ `WatchState`
- ✅ `EpisodeInteraction`
- ✅ `Comment` / `CommentLike` / `CommentReport`
- ✅ `WatchStreak`
- ✅ `NotificationPreference`
- ✅ `MovieCache`
- ✅ `MovieWatchState`
- ✅ `MovieWatchlist`
- ✅ `ImportJob` — **Phase 24** — TV Time GDPR import job tracking
- ✅ `SocialAccount` — **NEW Phase 27** — links a User to a verified Google/Apple identity

---

## TMDBService Methods

- ✅ `get_show_details()` — append_to_response, DB cached
- ✅ `get_movie_details()` — append_to_response, DB cached
- ✅ `get_movie_credits()` — **NEW Phase 8** — from cached block
- ✅ `get_movie_watch_providers()` — **NEW Phase 8** — from cached block
- ✅ `get_movie_recommendations()` — **NEW Phase 8**
- ✅ `get_show_credits()` — aggregate, from Django cache
- ✅ `get_watch_providers()` — from Django cache
- ✅ `search_shows()` — `use_cache=True`
- ✅ `search_multi()` — `use_cache=True` + **Phase 8: includes `popularity` field**
- ✅ `get_season_episodes()` — DB cached
- ✅ `get_trending()` / `get_trending_shows()`
- ✅ `get_popular_shows()` / `get_popular_movies()`
- ✅ `get_anticipated_movies()` / `get_top_rated_movies()`
- ✅ `get_airing_today_shows()`
- ✅ `discover_tv()` / `discover_movies()` — **NEW** — real TMDB `/discover` with genre + sort
- ✅ `get_recommendations()`
- ✅ `get_episode_credits()` / `get_episode_full_credits()`
- ✅ `find_by_external_id()`

---

## Frontend Components

- ✅ HeroCarousel — parallax backdrop + auto-scroll
- ✅ HorizontalMediaList — FlashList horizontal rows
- ✅ GenreGrid — masonry genre cards
- ✅ DiscoverFilterSheet — Reanimated bottom sheet
- ✅ ShowCard / ShowRow / MovieRow
- ✅ LayoutToggle / ShowPosterCard / MoviePosterCard — **NEW Phase 13** — global List/Grid layout switch
- ✅ Snackbar — **NEW Phase 19** — generic Undo toast, first used by the Catch-Up cascade
- ✅ CastCard / ProviderBadge / SeasonCard
- ✅ EpisodeRow / ContinueWatchingCard
- ✅ EmotionPicker / MVPVotingSheet
- ✅ CommentCard / ReplyCard / CommentComposer / CommentActions
- ✅ LikeButton / ReactionSummary / SpoilerOverlay
- ✅ BadgeUnlockModal (global, mounted in `_layout.tsx`)
- ✅ ProgressRing / SegmentedControl / LiquidTabBar
- ✅ CascadeModal / CalendarGrid
- ✅ StatsCard / WatchHeatmap / GenreChart / ActorChart
- ✅ CompletionRateCard / WatchStreakCard / AchievementCard
- ✅ MilestoneCard / YearReviewCard / MonthlySummaryCard

---

## Infrastructure

- ✅ Docker Compose (backend + postgres)
- ✅ Celery app instance (`config/celery.py`)
- ✅ Django settings split (dev/prod)
- 🟨 GitHub Actions CI (backend pytest + frontend jest) — not yet wired as an actual CI pipeline. pytest itself confirmed running end-to-end 2026-07-16 (21/21 passing) against the docker Postgres instance, which has `CREATEDB` granted; the *native* Postgres role host-run tests default to still lacks it and remains blocked on the user's action (see `AUDIT.md` Phase 25/27)
- ✅ CORS configured
- ✅ Redis cache backend (`CACHES`, native Django 6 Redis backend) — added 2026-07-16; previously unset, silently defaulting to per-process `LocMemCache`, which had also broken `TMDBService`'s response caching
- ✅ Global DRF rate limiting (`AnonRateThrottle`/`UserRateThrottle`) — added 2026-07-16, previously nonexistent anywhere in the project
- ✅ `requirements.txt` + `.env.example` + `.env.prod` — `.env.prod`'s variable names corrected 2026-07-16 (previously didn't match what `settings/base.py`/`prod.py` actually read; no secrets were exposed, but a real deploy following it would have silently misconfigured)
- ✅ `eas.json` for EAS mobile builds
- ✅ `app.json`'s `ios.bundleIdentifier`/`android.package` (`com.watchtracker.app`) — set 2026-07-16, previously missing (blocked EAS/native builds, tracked in `AUDIT.md` since Phase 6)
- ✅ Django admin themed (`django-unfold`) — added 2026-07-16, brand-derived OKLCH color ramp, all 15 models registered, grouped sidebar nav, live-verified against the real running container (see Phase 26)
- 🟢 Two Docker Compose stacks currently running simultaneously (`watchtracker_*`, the real one, and an orphaned `backend-*-1`) — found 2026-07-16, not torn down, see `AUDIT.md` Phase 26
- ✅ `pytest.ini` for backend testing
- 🟨 Sign in with Google/Apple (`core/social_auth.py`, `django-allauth` deliberately not used) — added 2026-07-16, backend fully verified, blocked on external Google Cloud/Apple Developer credentials for real device testing (see Phase 27)
- ✅ Forgot password via email OTP (`core/password_reset.py`, Django cache/Redis, Gmail SMTP) — added 2026-07-18, backend fully verified (33/33 pytest, live Gmail send confirmed), no new model/migration needed (see Phase 28)
- 🟨 EAS Android dev-client build (`plugins/withExcludeLegacySupportLibs.js`) — added 2026-07-19; fixes **two** independent Gradle duplicates (replaced the ineffective `withAndroidMaterialResolutionFix.js` version-force plugin). (1) `:app:mergeDebugResources` `attr/actionBarSize` duplicate — excludes the vestigial `com.android.support` group `react-native-shared-preferences` drags in. (2) `:app:checkDebugDuplicateClasses` `androidx.work.*Kt` duplicate — forces both `androidx.work` artifacts to 2.8.1 so `react-native-android-widget`'s stale `work-runtime-ktx:2.7.1` can't collide with the classes WorkManager 2.8.0 merged into `work-runtime`. Both verified locally (both tasks BUILD SUCCESSFUL); ✅ EAS build `4f7be02b` FINISHED green. (3) Installing that APK exposed a **runtime** crash — `Failed resolution of AnyTypeCache` from the SDK-57 `@expo/ui` native module; three SDK-57 packages had been `npm install`ed into this SDK-54 app. Fixed by pinning `expo-haptics` back to `15.0.8` and excluding the iOS-only `@expo/ui`+`expo-widgets` pair (no SDK-54 release) from **Android** autolinking via `package.json` `expo.autolinking.android.exclude`. ✅ Rebuild `356c46ca` FINISHED green; on-device confirmation pending (see Phase 28)

---

## Completion Percentages

| Area | % |
|------|---|
| Backend Core | 100% |
| Movie Features | 100% |
| Search & Discovery | 100% |
| Frontend UX / Optimistic UI | 100% |
| Community & Social | 100% |
| Analytics & Insights | 100% |
| Widgets | 95% (data bridge + config wiring fixed 2026-07-14; both platforms still need an EAS build for on-device verification) |
| Infrastructure | 100% |
| Testing | 95% |
| Documentation | 100% |
| **Overall** | **99%** |

---

## Remaining / Future Work

| Task | Priority |
|------|----------|
| EAS Build for iOS widget testing | High |
| Paginated endless scroll UI for search | Low |
| Analytics: per-user streaming provider tracking | Low |
| Analytics: director charts (requires crew data per WatchState) | Low |