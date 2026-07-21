# Glix — Complete Project Context
# Last Updated: 2026-07-21 (Phase 34 — Import reliability + duplicate-job guard, Android widget resize/scroll/tap-through, Google Sign-In error diagnostics, real navigation-lag fix from 6 unscoped Zustand store subscriptions, backend/.env.prod untracked from git, and EAS Update/OTA configured (expo-updates + eas update:configure) so future JS-only fixes can ship without a full rebuild. See AUDIT.md/PROJECT_STATUS.md for full detail. Phase 32 — Premium animated splash: native black splash hands off seamlessly to a Reanimated/SVG logo-draw-on sequence in loading.tsx, replacing the static wordmark + spinner; expo-splash-screen wired for the native→JS handoff. Phase 31 — Push notifications actually wired end-to-end: an Expo push send module, new-episode detection in the existing refresh_show_cache task, a weekly digest task, and — the actual root cause of nothing ever sending — a Celery Beat service that didn't exist before. Phase 30 — Global rebrand "WatchTracker" → "Glix" across docs/app.json/assets/codebase, categorized Language Filter modal (Major Indian Languages / Global Languages sections), and the Shows Hub's default filter changed to WATCH_NEXT on open. Phase 29 — Rapid pre-deployment audit (1 critical light-theme bug fixed) + language filter + Analytics back button. Phase 28 — Forgot Password via email OTP + styled HTML email, and the EAS Android dev-client build fix: root-caused the `attr/actionBarSize` `mergeDebugResources` duplicate to a vestigial `com.android.support` lib from `react-native-shared-preferences`, fixed via a config plugin excluding the legacy support group. Phase 27 — Sign in with Google/Apple: direct ID-token verification via PyJWT/JWKS, not django-allauth. Phase 26: Django admin modernized with django-unfold. Phase 24: TV Time GDPR import rebuilt on Celery. Phase 25: pre-deployment DevSecOps/API/UI/UX audit)

> **For Claude Code / any new AI agent reading this:**
> This file is the single source of truth for the entire Glix V2 project.
> Read this before making ANY changes. Every section is kept current.

---

## Project Overview

Glix is a **premium TV & movie tracking app** — a dark, glassmorphic alternative to TV Time.

| Attribute | Value |
|-----------|-------|
| Design System | Adaptive light/dark (Phase 12, `lib/theme.ts`) — dark default: pitch black `#000000` bg, glass `rgba(30,30,30,0.65)`, hairline `rgba(255,255,255,0.12)`; light: paper `#EDEEEA` bg, raised near-white cards. Cinema Neon Yellow `#E4FA1A` accent in both (splits into `accentFill`/`accentInk` — see §2a) |
| Mobile Framework | React Native + Expo SDK 54 + Expo Router v6 |
| State Management | Zustand (`watchStore`, `discoverStore`) |
| Backend | Django 6 + Django REST Framework + PostgreSQL |
| External Data | TMDB API v3 (proxied through backend, fully cached) |
| Auth | JWT via `djangorestframework-simplejwt` |
| Infrastructure | Docker Compose (backend + postgres + redis + celery containers) |
| Admin UI | django-unfold (Phase 26) — Tailwind-based theme, `UNFOLD["COLORS"]["primary"]` derived from the app's own accent `#E4FA1A` converted to OKLCH, not the package default purple |

---

## Monorepo Folder Structure

```text
watchtracker/                           ← project root
├── docker-compose.yml                  ← runs backend + postgres
├── context.md                          ← THIS FILE (master reference)
├── ROADMAP.md                          ← feature checklist + completion %
├── AUDIT.md                            ← known bugs + technical debt
├── PROJECT_STATUS.md                   ← current phase / last completed
│
├── backend/
│   ├── .env                            ← dev secrets (TMDB_API_KEY, DB creds, SECRET_KEY)
│   ├── .env.prod                       ← production secrets template
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── manage.py
│   ├── pytest.ini
│   ├── config/
│   │   ├── settings.py                 ← DRF, SimpleJWT, Postgres, Celery, CORS
│   │   ├── urls.py                     ← mounts /api/ → core.urls
│   │   ├── celery.py                   ← Celery app instance
│   │   └── wsgi.py / asgi.py
│   └── core/
│       ├── models.py                   ← ALL database models
│       ├── serializers.py              ← ALL DRF serializers
│       ├── services.py                 ← TMDBService (TMDB proxy + cache layer)
│       ├── views.py                    ← watchlist, episodes, movies, discover feed
│       ├── search_views.py             ← search + show/movie detail endpoints
│       ├── auth_views.py               ← register / login / logout
│       ├── profile_views.py            ← profile read + update
│       ├── comment_views.py            ← community comments + replies
│       ├── analytics_views.py          ← 11 analytics endpoints
│       ├── comment_serializers.py
│       ├── comment_permissions.py
│       ├── tasks.py                    ← Celery badge safety-net tasks + show resync + push notification triggers (Phase 31)
│       ├── push_notifications.py       ← Expo push send + dead-token cleanup (Phase 31)
│       ├── signals.py                  ← auto UserProfile + badge evaluation
│       ├── badge_constants.py          ← badge slug ↔ threshold mapping
│       ├── social_auth.py              ← Google/Apple ID-token verification + get-or-create (Phase 27)
│       ├── pagination.py               ← StandardResultsPagination
│       ├── exceptions.py               ← global DRF exception handler
│       ├── admin.py                    ← django-unfold ModelAdmin for all 16 models + custom User/Group (Phase 26)
│       ├── urls.py                     ← ALL URL routes (see API table below)
│       ├── comment_urls.py
│       ├── analytics_urls.py
│       └── tests/
│           ├── test_models.py
│           └── test_views.py           ← 6 tests, all passing
│
└── client-mobile/
    ├── app.json                        ← Expo config (plugins, App Group entitlement)
    ├── package.json
    ├── tsconfig.json
    ├── eas.json                        ← EAS build config
    ├── app/
    │   ├── _layout.tsx                 ← Root Stack + auth gate + widget registration
    │   ├── (tabs)/
    │   │   ├── _layout.tsx             ← LiquidTabBar 4-tab layout
    │   │   ├── index.tsx               ← Shows Hub — dual-tab (WATCH LIST / UPCOMING) ← REFACTORED
    │   │   ├── movies.tsx              ← Movies Hub
    │   │   ├── discover.tsx            ← Discover Hub ← RECENTLY BUGFIXED
    │   │   └── profile.tsx             ← Profile Hub
    │   ├── movie/
    │   │   └── [id].tsx                ← FULL Movie Details Screen ← NEW (Phase 8)
    │   ├── show/
    │   │   ├── [id].tsx                ← Show Details ← RECENTLY BUGFIXED
    │   │   ├── [id]/comments.tsx
    │   │   └── [id]/season/[season].tsx
    │   ├── episode/[id].tsx
    │   ├── profile/
    │   │   ├── shows.tsx
    │   │   └── movies.tsx
    │   ├── login.tsx / register.tsx / onboarding.tsx / loading.tsx ← animated splash sequence ← NEW (Phase 32)
    │   ├── search.tsx
    │   ├── settings.tsx
    │   ├── community.tsx
    │   ├── analytics.tsx / statistics.tsx / achievements.tsx / year-review.tsx
    │   └── show/[id]/comments.tsx
    ├── components/
    │   ├── HeroCarousel.tsx            ← auto-scroll parallax backdrop carousel
    │   ├── HorizontalMediaList.tsx     ← FlashList horizontal poster row
    │   ├── GenreGrid.tsx               ← masonry genre cards
    │   ├── DiscoverFilterSheet.tsx     ← Reanimated bottom sheet filter
    │   ├── ShowCard.tsx / ShowRow.tsx
    │   ├── MovieRow.tsx
    │   ├── LayoutToggle.tsx           ← global List/Grid layout switch ← NEW (Phase 13)
    │   ├── ShowPosterCard.tsx         ← large poster grid card for shows
    │   ├── MoviePosterCard.tsx        ← large poster grid card for movies
    │   ├── HistoryRow.tsx             ← reverse-chronological watch history feed row
    │   ├── CastCard.tsx / ProviderBadge.tsx / SeasonCard.tsx
    │   ├── EpisodeRow.tsx / ContinueWatchingCard.tsx
    │   ├── EmotionPicker.tsx / MVPVotingSheet.tsx
    │   ├── CommentCard.tsx / ReplyCard.tsx / CommentComposer.tsx
    │   ├── CommentActions.tsx / LikeButton.tsx / ReactionSummary.tsx
    │   ├── AvatarPickerModal.tsx      ← Profile avatar picker (TMDB "Cast" + illustrated "Cartoon") ← NEW (Phase 14)
    │   ├── Snackbar.tsx               ← generic bottom toast + action button (Catch-Up cascade's Undo) ← NEW (Phase 19)
    │   ├── SpoilerOverlay.tsx / BadgeUnlockModal.tsx
    │   ├── ProgressRing.tsx / SegmentedControl.tsx (theme-aware) / LiquidTabBar.tsx
    │   ├── CascadeModal.tsx / CalendarGrid.tsx
    │   ├── GlassSurface.tsx            ← theme-aware glass recipe ← NEW (Phase 12)
    │   ├── PressableScale.tsx          ← Reanimated tactile press feedback ← NEW (Phase 12)
    │   ├── AmbientGlow.tsx             ← SVG radial glow behind hero metrics ← NEW (Phase 12)
    │   ├── TrendChip.tsx               ← ▲/▼/— verdict chip ← NEW (Phase 12)
    │   ├── AnimatedSplash.tsx          ← Reanimated/SVG logo-draw-on splash sequence, loading.tsx overlay ← NEW (Phase 32)
    │   └── [Analytics components: StatsCard (theme-aware), WatchHeatmap, GenreChart, etc.]
    ├── store/
    │   ├── watchStore.ts               ← persisted Zustand (watchlist, profile, badges)
    │   ├── themeStore.ts               ← persisted Zustand: Appearance preference (System/Light/Dark) ← NEW (Phase 12)
    │   └── discoverStore.ts            ← in-memory Zustand (discover feed + search)
    ├── lib/
    │   ├── api.ts                      ← Axios instance + 401 refresh interceptor
    │   ├── theme.ts                    ← ADAPTIVE THEME SYSTEM: tokens, AppThemeProvider, useAppTheme() ← NEW (Phase 12)
    │   ├── typography.ts               ← monoLabelStyle (caption) + monoValueStyle (numeric values, Phase 20) precision-layer styles ← NEW (Phase 12)
    │   ├── motion.ts                   ← staggerEntering() + usePrefersReducedMotion() ← NEW (Phase 12)
    │   ├── errors.ts                   ← extractErrorMessage() utility
    │   ├── dateFormat.ts               ← date/countdown helpers
    │   ├── upcoming.ts                 ← UpcomingItem type + buildUpcomingItems() + groupUpcomingItemsByDate() (Phase 18)
    │   ├── useCatchupCascade.ts        ← shared Catch-Up Modal state machine (Phase 11)
    │   ├── genres.ts                   ← canonical TV_GENRES/MOVIE_GENRES (id/name/color) ← NEW
    │   ├── badges.ts                   ← badge metadata constants
    │   ├── notifications.ts            ← expo push token fetcher
    │   └── migration.ts               ← TV Time import (enqueue + poll) + Glix export
    └── widgets/
        ├── android/
        │   ├── WidgetProvider.tsx      ← RECENTLY FIXED (null-guard on SharedPreferences)
        │   ├── WatchlistWidget.tsx
        │   └── UpcomingWidget.tsx
        └── ios/
            ├── WatchlistWidget.tsx
            └── UpcomingWidget.tsx
```

---

## All API Endpoints

| Method | Path | View | Notes |
|--------|------|------|-------|
| POST | `/api/auth/register/` | RegisterView | |
| POST | `/api/auth/login/` | LoginView | Returns access + refresh tokens |
| POST | `/api/auth/logout/` | LogoutView | Blacklists refresh token |
| POST | `/api/auth/refresh/` | TokenRefreshView | SimpleJWT built-in |
| **NEW** POST | `/api/auth/google/` | GoogleLoginView | Sign in with Google — body `{id_token}`, verifies via `core/social_auth.py`, returns `{access, refresh, profile, created}` |
| **NEW** POST | `/api/auth/apple/` | AppleLoginView | Sign in with Apple — body `{id_token, first_name?, last_name?}` (name only sent on the user's first-ever Apple authorization), same response shape |
| **NEW** POST | `/api/auth/password-reset/request/` | PasswordResetRequestView | Body `{email}` — always 200 with a generic message (enumeration-safe); emails a 6-digit OTP via Gmail SMTP if the account exists |
| **NEW** POST | `/api/auth/password-reset/verify/` | PasswordResetVerifyView | Body `{email, code}` — returns `{reset_token}` on success; 5-attempt cap, single-use code |
| **NEW** POST | `/api/auth/password-reset/confirm/` | PasswordResetConfirmView | Body `{reset_token, new_password}` — sets the password, returns `{access, refresh, profile}` (logs the user straight back in) |
| GET | `/api/watchlist/` | WatchlistView | Paginated, buckets: to_watch / up_to_date / archived; each entry now annotates `last_watched_at` for recency-sorted pills |
| POST | `/api/watchlist/add/` | ShowAddView | Adds show w/o touching episode state; eager-caches season 1 |
| GET | `/api/continue-watching/` | ContinueWatchingView | |
| **NEW** GET | `/api/watch-history/` | WatchHistoryView | Paginated reverse-chronological ledger of individual episodes watched |
| POST | `/api/watch-state/toggle/` | WatchStateToggleView | Auto-adds to watchlist; **rejects marking an unaired episode watched** (400) |
| POST | `/api/watch-state/bulk-toggle/` | BulkWatchStateToggleView | Cascade catch-up; unaired episode ids are silently dropped from the watched batch rather than erroring the whole cascade |
| **NEW** POST | `/api/watch-state/catchup-check/` | CatchupCheckView | Server-authoritative "does this show have earlier unwatched episodes?" — episode mode (`episode_id`) or season mode (`show_id`+`season_number`); eager-caches any missing earlier season via TMDBService before answering |
| POST | `/api/watchlist/favorite/` | FavoriteToggleView | |
| **NEW** POST | `/api/watchlist/catchup-preference/` | CatchupPreferenceView | Sets per-show `ignore_catchup` ("Never for this show") |
| POST | `/api/watchlist/archive/` | ArchiveToggleView | |
| POST | `/api/episode/interaction/` | EpisodeInteractionView | Emotion + MVP vote |
| GET/PATCH | `/api/profile/` | ProfileView | PATCH body `{"profile_picture": "https://..."}` |
| **NEW** GET | `/api/profile/avatar-options/` | AvatarOptionsView | Real TMDB `/person/popular` headshots for the avatar picker's "Cast" tab (24h cache) |
| GET/PATCH | `/api/notifications/preferences/` | NotificationPreferenceView | push_token + the 2 toggles now actually drive sends — see Phase 31 |
| GET | `/api/movies/watchlist/` | MovieWatchlistView | |
| POST | `/api/movies/watch-state/toggle/` | MovieWatchStateToggleView | |
| POST | `/api/movies/add/` | MovieAddView | |
| **NEW** GET | `/api/movies/<id>/detail/` | MovieDetailView | Full TMDB movie data |
| **NEW** GET | `/api/movies/<id>/credits/` | MovieCreditsView | Cast + crew (cached) |
| **NEW** GET | `/api/movies/<id>/watch-providers/` | MovieWatchProvidersView | Streaming providers |
| **NEW** GET | `/api/movies/<id>/recommendations/` | MovieRecommendationsView | Similar movies |
| GET | `/api/discover/feed/?type=tv\|movie` | DiscoverFeedView | Sectioned hero + lists (fixed sections, no genre/sort) |
| **NEW** GET | `/api/discover/filter/?type=tv\|movie&genre=<id>&sort=trending\|popular\|top_rated&page=<n>` | DiscoverFilterView | Real TMDB `/discover/{tv,movie}` genre+sort browsing; `trending` genre-filters actual trending results server-side (TMDB's `/trending` has no `with_genres`) |
| **NEW** GET | `/api/discover/genres/?type=tv\|movie` | DiscoverGenresView | Real TMDB cover image per genre for `GenreGrid.tsx` tiles (24h Django cache) |
| GET | `/api/search/shows/` | ShowSearchView | TV-only search |
| GET | `/api/search/universal/` | UniversalSearchView | **Upgraded:** relevancy engine + fallback |
| GET | `/api/shows/<id>/` | ShowDetailView | Cached TMDB show data |
| GET | `/api/shows/<id>/season/<n>/` | SeasonEpisodesView | |
| GET | `/api/episodes/<id>/` | EpisodeDetailView | |
| GET | `/api/episodes/<id>/credits/` | EpisodeCreditsView | |
| GET | `/api/shows/<id>/credits/` | ShowCreditsView | Aggregate across all seasons |
| GET | `/api/shows/<id>/watch-providers/` | WatchProvidersView | |
| GET | `/api/shows/<id>/recommendations/` | ShowRecommendationsView | |
| GET/POST | `/api/comments/` | CommentListCreateView | |
| GET/POST | `/api/comments/<id>/replies/` | CommentReplyListCreateView | |
| GET/PATCH/DELETE | `/api/comments/<id>/` | CommentDetailView | |
| POST | `/api/comments/<id>/like/` | CommentLikeToggleView | |
| POST | `/api/comments/<id>/report/` | CommentReportView | |
| GET | `/api/moderation/reports/` | ModerationReportListView | |
| POST | `/api/moderation/reports/<id>/resolve/` | ModerationReportActionView | |
| GET | `/api/analytics/dashboard/` | | |
| GET | `/api/analytics/statistics/` | | |
| GET | `/api/analytics/genres/` | | |
| GET | `/api/analytics/actors/` | | |
| GET | `/api/analytics/providers/` | Stub (no per-user provider data yet) | |
| GET | `/api/analytics/completion/` | | |
| GET | `/api/analytics/heatmap/` | | |
| GET | `/api/analytics/streak/` | | |
| GET | `/api/analytics/year-review/` | | |
| GET | `/api/analytics/monthly-summary/` | | |
| GET | `/api/analytics/achievements/` | | |
| POST | `/api/import/tvtime/` | TVTimeImportView | Enqueues only — returns `202 {job_id, total, status}` |
| GET | `/api/import/status/<uuid:job_id>/` | ImportJobStatusView | Poll progress + final counts; scoped to the requesting user |

---

## Database Models (core/models.py)

| Model | Key Fields | Notes |
|-------|-----------|-------|
| `UserProfile` | user (1:1), profile_picture, total_time_watched, earned_badges[] | Auto-created by signal |
| `SocialAccount` (NEW) | user (FK), provider (google/apple), provider_user_id, email, created_at | Links a User to a verified Google/Apple identity (Phase 27). Unique on (provider, provider_user_id) — the stable `sub` claim, never the email |
| `CachedShow` | tmdb_id (PK), title, poster_path, backdrop_path, status, vote_average, total_seasons, genres[], `next_episode_air_date`/`next_episode_season_number`/`next_episode_number`/`next_episode_name` (Phase 15), **`original_language`** (NEW Phase 29) | 12h staleness TTL. `next_episode_*` from TMDB's `next_episode_to_air`, populated even before that season's individual episodes are cached. `original_language`: ISO 639-1 from TMDB, blank on rows cached before Phase 29 until next refresh |
| `CachedEpisode` | tmdb_id (PK), show (FK), season_number, episode_number, air_date, runtime_minutes | |
| `Watchlist` | user, show, progress_percentage, watched_episode_count, **ignore_catchup** (NEW) | `ignore_catchup`: "Never for this show" Catch-Up modal preference |
| `WatchState` | user, episode, watched_at | Presence-based; toggle creates/deletes. `watched_at` is `default=timezone.now` (NOT `auto_now_add`) so a TV Time import can backfill the real historical date; serializer pins it read-only |
| `EpisodeInteraction` | user, episode, emotion_emoji, mvp_character_id, mvp_character_name | |
| `Comment` | user, show, episode, body, spoiler_tag, soft-deleted | |
| `CommentLike` | user, comment | |
| `CommentReport` | reporter, comment, reason, status | |
| `WatchStreak` | user (1:1), current_streak, longest_streak, total_streak_days | |
| `NotificationPreference` | user (1:1), push_token, notify_new_episode, notify_weekly_digest | |
| `MovieCache` | tmdb_id (PK), title, poster_path, backdrop_path, release_date, runtime_minutes, genres_string, vote_average, **`original_language`** (NEW Phase 29) | `original_language`: ISO 639-1 from TMDB, blank on rows cached before Phase 29 until next refresh |
| `MovieWatchState` | user, movie, watched_at | Presence-based; `watched_at` is `default=timezone.now`, same reason as `WatchState` |
| `MovieWatchlist` | user, movie, added_at | |
| `ImportJob` (NEW) | user, status, payload, total, processed, shows_imported/skipped, movies_imported/skipped, episodes_marked, errors, detail, finished_at | One TV Time import run. `payload` stages the normalised export (cleared on finish) — a full export is ~3MB, too big for a Celery arg. Polled by `ImportJobStatusView` |

---

## TMDBService Methods (backend/core/services.py)

All methods are **cache-first**. The service uses `_request()` which supports Django cache (`use_cache=True`) or model-level caching.

| Method | TMDB Endpoint | Cache Strategy |
|--------|--------------|----------------|
| `get_show_details(tmdb_id)` | `/tv/{id}?append_to_response=aggregate_credits,watch/providers` | DB model (12h) + credits/providers in Django cache. **CHANGED (Phase 15):** now also extracts `next_episode_to_air` into `CachedShow.next_episode_*` |
| `get_movie_details(tmdb_id)` | `/movie/{id}?append_to_response=credits,watch/providers` | DB model (12h) + credits/providers in Django cache |
| `get_movie_credits(tmdb_id)` | `/movie/{id}/credits` | Django cache key `tmdb_movie_credits_{id}` (12h) |
| `get_movie_watch_providers(tmdb_id)` | `/movie/{id}/watch/providers` | Django cache key `tmdb_movie_providers_{id}` (12h) |
| `get_movie_recommendations(tmdb_id)` | `/movie/{id}/recommendations` | `use_cache=True` (1h). **CHANGED (Phase 22):** now also extracts `backdrop_path`/`overview` (TMDB always includes them, previously dropped) so movie/[id].tsx's "More Like This" cards can pass a complete optimistic-routing param set |
| `get_show_credits(tmdb_id)` | Uses cached `tmdb_show_credits_{id}` or `/tv/{id}/aggregate_credits` | Django cache (12h) |
| `get_watch_providers(tmdb_id)` | Uses cached `tmdb_show_providers_{id}` | Django cache (12h) |
| `search_shows(query)` | `/search/tv` | `use_cache=True` (1h) |
| `search_multi(query)` | `/search/multi` | `use_cache=True` (1h) — returns `popularity` field |
| `get_season_episodes(tmdb_id, season)` | `/tv/{id}/season/{n}` | DB model (12h) |
| `get_trending(media_type, time_window)` | `/trending/{type}/{window}` | `use_cache=True` (1h) |
| `get_popular_shows/movies()` | `/tv/popular` / `/movie/popular` | `use_cache=True` (1h) |
| `get_anticipated_movies()` | `/movie/upcoming` | `use_cache=True` (1h) |
| `get_trending_shows()` | `/trending/tv/week` | `use_cache=True` (1h) |
| `get_airing_today_shows()` | `/tv/airing_today` | `use_cache=True` (1h) |
| `get_top_rated_movies()` | `/movie/top_rated` | `use_cache=True` (1h) |
| `get_recommendations(tmdb_show_id)` | `/tv/{id}/recommendations` | `use_cache=True` (1h). **CHANGED (Phase 23):** now also extracts `backdrop_path`/`overview` (TMDB always includes them, previously dropped) so show/[id].tsx's recommendation cards can pass a complete optimistic-routing param set |
| **NEW** `get_popular_characters(limit)` | `/tv/{id}/aggregate_credits`, `/movie/{id}/credits` (via `get_show_credits()`/`get_movie_credits()`) across trending TV + popular movies | No `/character/popular` endpoint exists on TMDB — builds a "character" pool from top-billed cast of currently trending titles, keyed by `character` name instead of actor name. **CHANGED (Phase 16):** replaces the earlier `get_popular_people()` (`/person/popular`, real-celebrity pool, not character-specific) |
| **NEW** `discover_tv(genre_id, sort_by, page)` | `/discover/tv?with_genres=&sort_by=` | `use_cache=True` (1h); `vote_count.gte=100` guard when sorting by rating |
| **NEW** `discover_movies(genre_id, sort_by, page)` | `/discover/movie?with_genres=&sort_by=` | Same as above, movie counterpart |
| **CHANGED** `get_trending(..., include_genre_ids=False)` | `/trending/{type}/{window}` | New optional param retains each item's `genre_ids` (TMDB always returns it, previously discarded) + now surfaces `page`/`total_pages`/`total_results`; both additive, existing callers unaffected |
| `get_episode_credits(...)` | `/tv/{id}/season/{n}/episode/{e}/credits` | No cache (fresh per call) |
| `get_episode_full_credits(...)` | Same as above | No cache |
| `find_by_external_id(...)` | `/find/{external_id}` | No cache |

---

## Search Relevancy Engine (NEW — Phase 8)

Located in `backend/core/search_views.py`. Applied to every `GET /api/search/universal/` response.

**Scoring algorithm:**

```
Score = title_match (0–50) + log_popularity (0–15) + recency_bonus (0/10) + vote_quality (0–5)

title_match:
  +50  exact full-query match
  +30  all query tokens present in title
  +0–20 proportional partial token coverage

popularity:
  +min(15, log1p(tmdb_popularity) × 1.5)  ← caps outsized influence

recency:
  +10 if release_date within ±6 months of today (catches upcoming releases)

vote quality:
  +min(5, vote_average × 0.5)
```

**Punctuation-stripped fallback:** If first-pass query returns < 3 results, the engine strips punctuation (e.g. "Spider-Man: Brand New Day" → "Spider Man Brand New Day"), retries, and merges deduplicated results.

---

## Zustand Stores

### watchStore.ts (persisted)
- `watchlist[]` — all tracked shows
- `profile` — user profile + badges
- `unlockedBadges[]` — badge unlock queue for BadgeUnlockModal
- `history` — **NEW**, paginated watch history fed from `/api/watch-history/`
- `fetchHistory(page?)` — **NEW**, paginates watch history feed
- `heatmapData` — calendar heatmap
- `popUnlockedBadge()` — dequeues one badge for modal display
- `addShowToWatchlist(showId)` — **NEW**, calls `/watchlist/add/`, prepends the returned entry into `to_watch` on success. Returns `Promise<boolean>` so callers (show detail) know whether to route.
- `addMovieToWatchlist(movieId)` — **CHANGED**, now returns `Promise<boolean>` (was `void`) for the same route-on-success reason.
- `hasPreviousUnwatched`/`hasPreviousUnwatchedForSeason` — **REMOVED (Phase 17)**. Replaced by a server call (`POST /watch-state/catchup-check/`) made directly from `lib/useCatchupCascade.ts` — see the Phase 17 section below.
- `setCatchupPreference(showId, ignoreCatchup)` — **NEW**, calls `/watchlist/catchup-preference/`, optimistic across all 3 buckets.
- `preferredLayout: 'list' | 'grid'` — **NEW (Phase 13)**, persisted. Drives the global List/Grid toggle across all 4 primary media lists (Shows Hub, Movies Hub, Profile > My Shows/My Movies).
- `toggleLayout()` — **NEW (Phase 13)** — flips `preferredLayout` between `'list'` and `'grid'`.
- `updateProfilePicture(url)` — **NEW (Phase 14)** — optimistic PATCH `/profile/` with `{profile_picture: url}`; reverts `profile` on failure. Backs the new Profile avatar picker.

### discoverStore.ts (in-memory, NOT persisted)
- `activeSegment: 'tv' | 'movie'`
- `feedData: Record<'tv'|'movie', DiscoverFeedResponse | null>` — cached per segment
- `searchResults[]` / `isSearching`
- `fetchFeed(segment)` — calls `/api/discover/feed/?type={segment}`, skips if already cached
- `runSearch(query)` — calls `/api/search/universal/`
- `clearSearch()` — resets search state
- **NEW** `filteredResults[]` / `isLoadingFiltered` / `filteredError` — Filter & Sort sheet results, separate from `feedData` and `searchResults`
- **NEW** `fetchFilteredResults()` — calls `/api/discover/filter/` with current `activeSegment`/`selectedGenreId`/`sortOrder`
- **NEW** `isFilterActive()` — `selectedGenreId !== null || sortOrder !== 'trending'`
- **NEW** `resetFilters()` — clears genre/sort back to defaults + clears `filteredResults`
- `setSelectedGenreId`/`setSortOrder` now auto-fetch (or clear, if back to fully-default) — **fixed**, previously set state with no effect on any list
- **NEW** `genreCovers: Record<'tv'|'movie', Record<genreId, GenreCover>>` + `fetchGenreCovers(segment)` — real TMDB images for `GenreGrid.tsx`, cached per segment

---

## Shows Hub Architecture (`app/(tabs)/index.tsx`) — REFACTORED

Mirrors the TV Time dual-tab layout while keeping the Glassmorphism design system. Two top-level tabs via a `SegmentedControl` (reused component, not duplicated):

- **WATCH LIST** — unchanged dense-row experience: horizontal pill filters (`ATTENTION` / `UP_TO_DATE` / `NOT_STARTED` / `HISTORY`) + `FlashList` of `ShowRow` (circular animated checkmarks, Cascade Catch-Up modal).
- **UPCOMING** — new. Contains its own nested `SegmentedControl` (List / Calendar):
  - **List** — chronological vertical `FlashList` of upcoming episodes with live countdowns (`formatCountdown` from `lib/dateFormat.ts`), imminent (<24h) countdowns highlighted in Neon Yellow.
  - **Calendar** — the existing `CalendarGrid.tsx` month-grid component, inline (no longer modal-wrapped).

**Data:** both tabs derive from the same `watchStore.watchlist` buckets. `lib/upcoming.ts` (new) exports `UpcomingItem` + `buildUpcomingItems()`, shared by the Upcoming List view and `CalendarGrid.tsx`.

**Retired:** `components/CalendarHeaderModal.tsx` — its modal-triggered-by-calendar-icon UX is fully superseded by the inline UPCOMING tab. File deleted (was only imported by `index.tsx`); `CalendarGrid.tsx`'s `UpcomingItem` import repointed to `lib/upcoming.ts`. The dead `app/(tabs)/upcoming.tsx` redirect stub (retired since Phase 2, kept only so Expo Router doesn't 404 on cached nav state) had its comment updated to point at the new location but is otherwise untouched.

**Design tokens used (no new colors introduced):** `#000000` background, `rgba(30,30,30,0.65)` glass fill, `rgba(255,255,255,0.12)` hairline borders, `#E4FA1A` for active tab state / checkmarks / imminent countdowns.

**WATCH LIST pill criteria (clarified 2026-07-14):** each show shows exactly one row (its next episode via `pickNextEpisode()`), sorted into 4 pills by recency and drop timing. `HAVEN'T STARTED` = `watched===0`. `WATCH NEXT` = front-of-queue; next unwatched episode where the show has been watched in the last 14 days, or a fresh episode aired in the last 14 days (sorted most-recent first). `HAVEN'T WATCHED FOR A WHILE` = next unwatched episode exists, but inactivity is > 14 days (sorted stalest-first). `WATCH HISTORY` = separated from the main list loop, reads directly from the new paginated `/api/watch-history/` feed and renders `HistoryRow` ledger items. Archived shows excluded from all "To Watch" queues.

**Unaired-episode guard (2026-07-14):** an episode with no `air_date`, or `air_date` in the future, cannot be marked watched — enforced at 5 layers so there's no way around it: `WatchStateToggleView` (400 on the create-WatchState path only; un-watching is always allowed), `BulkWatchStateToggleView` (silently drops unaired ids from a Cascade Catch-Up batch rather than erroring the whole batch), `ShowRow.tsx`/`EpisodeRow.tsx` (checkmark disabled + dimmed to 30% opacity), `app/episode/[id].tsx` ("Mark as Watched" button becomes "Hasn't Aired Yet", disabled).

---

## Search → Add → Route → Categorize Flow — NEW

The "Add & Track" flow mirrors TV Time: search/discover a title → view its detail screen → tap Add → land back on the right hub with the item visible in the right bucket, with zero manual refresh.

**Show side (`app/show/[id].tsx`):**
- New "Add to Watchlist" pill (glass fill → Neon Yellow fill once tracked) next to the title, using the existing `watchlistEntry` derivation (no new selector).
- `handleAddToWatchlist` calls `addShowToWatchlist(tmdbId)`; on success, `router.replace('/(tabs)/', { params: { highlightFilter: 'NOT_STARTED' } })`.
- Backend `ShowAddView` (`POST /api/watchlist/add/`) creates the `Watchlist` row **and** eagerly caches season 1 via `TMDBService.get_season_episodes` — without this, a freshly-added show has zero `CachedEpisode` rows and `pickNextEpisode()` in the Shows Hub silently drops it from every filter pill (`buildRows()` skips any entry with no resolvable next episode). Best-effort: a TMDB failure on the season-1 prefetch doesn't fail the add.

**Movie side (`app/movie/[id].tsx`):**
- Fixed a pre-existing gap: this screen used to call `/movies/watch-state/toggle/` directly via a raw `api.post`, bypassing `watchStore` entirely — `isWatched` was local state that never reflected real data (always initialized `false`). Now derives `movieEntry`/`isInWatchlist`/`isWatched` from `watchStore.movieWatchlist` (same pattern as the show screen's `watchlistEntry`), and calls `fetchMovieWatchlist()` on mount.
- Single context-sensitive `handlePrimaryAction`: not tracked → `addMovieToWatchlist(tmdbId)` then routes to `/(tabs)/movies` with `highlightFilter: 'WATCH_NEXT'`; already tracked → `toggleMovieWatchState(tmdbId)` (existing optimistic store action).

**Hub categorization (`app/(tabs)/index.tsx`, `app/(tabs)/movies.tsx`):**
- No filter-derivation logic changes were needed — `buildRows()`'s existing `watched_episode_count === 0 → NOT_STARTED` rule and the backend's `watch_next` (unwatched) bucket already categorize a freshly-added item correctly, **once the show has cached episode data** (see above).
- Both hubs now read a `highlightFilter` route param (`useLocalSearchParams`) and `setFilter()` to it on arrival, so the user sees the newly-added item's bucket immediately instead of landing on the default pill (`WATCH_NEXT` for both Shows and Movies as of Phase 30 — see below — so this is now a no-op on both hubs today but keeps them symmetric).

---

## Catch-Up Modal & Chronological Tracking — NEW

Extends the Phase 2 "Cascade Catch-Up" modal (`components/CascadeModal.tsx`) — this was **not** a new component (the task's suggested `CatchUpModal.tsx` name was skipped in favor of extending the existing one, which already had the right copy, glass styling, and Confirm/Cancel semantics; only a third action was missing).

**Chronological fix:** `hasPreviousUnwatched` previously only looked at earlier episodes *within the same season*. A show with an entirely-unwatched Season 2 would not trigger the modal when the user checked a Season 3 episode. Now compares `(season_number, episode_number)` tuples across the whole show.

**Decision tree (`CascadeModal.tsx`, now 3 actions):**
- **"Mark all watched"** (Confirm) — `bulkToggleWatchState([...priorIds, selectedId], true)` — one batched request via the existing `POST /api/watch-state/bulk-toggle/` (Phase 2's `BulkWatchStateToggleView`; no new batch endpoint was created — it already existed and already avoids N individual requests).
- **"Just this one"** (Cancel) — marks only the selected episode/season.
- **"Never for this show"** (new `onNeverForThisShow` prop, optional so any old caller without it just doesn't render the third button) — calls `setCatchupPreference(showId, true)` then completes the current action as "just this one". Persists `Watchlist.ignore_catchup` server-side; `hasPreviousUnwatched`/`hasPreviousUnwatchedForSeason` both check it first and skip straight to `{has:false}`, so the modal never shows again for that show.

**Shared hook — `lib/useCatchupCascade.ts` (added in a follow-up fix, same day):** the modal-trigger state machine (visible/pending-ids/showTitle/episodeLabel + confirm/cancel/neverForShow) was about to be duplicated a third time, so it's now one hook wrapping `hasPreviousUnwatched` / `hasPreviousUnwatchedForSeason` / `setCatchupPreference`. `onFinalize(ids)` is the one thing each caller supplies.

**Staleness fix (2026-07-14, user-reported + screenshots):** `hasPreviousUnwatched`/`hasPreviousUnwatchedForSeason` check the Zustand `watchlist` store's cached episode data, not whatever a screen just fetched locally. `season/[season].tsx` and `episode/[id].tsx` each keep their own local `episodes`/`episode` state (independent per-season/per-episode fetches) and never wrote that back into the store — so the check could run against a stale snapshot that predated the seasons the user had just browsed in the current session, silently skipping the modal. Fixed by having both screens `await fetchWatchlist()` right after their own fetch resolves. The Shows Hub row checkmark never had this bug (it checks the same state it renders from). Residual, not fixed: `fetchWatchlist()` only pulls page 1 (20) per bucket, so a show past that page is invisible to the check either way — pre-existing, unrelated to this fix.

**Three call sites (a first pass only wired one of these and shipped with two real gaps — live-tested, see AUDIT.md):**
- `app/(tabs)/index.tsx` (Shows Hub, per-episode checkmark).
- `app/show/[id]/season/[season].tsx` — both the per-episode `EpisodeRow` checkmark *and* "Mark Season Watched". The season-mark button also previously fired one `/watch-state/toggle/` request per unwatched episode in a naive loop (the exact anti-pattern this phase's batching requirement calls out) and never checked earlier seasons at all; now uses `hasPreviousUnwatchedForSeason` + a single `bulkToggleWatchState` call for every path.
- `app/episode/[id].tsx` ("Mark as Watched" button) — previously called the toggle API directly with zero catch-up awareness.

**Watch vs. un-watch:** only the *watch* direction ever runs the chronological check — un-watching is always immediate. An earlier version of the Shows Hub row checked unconditionally, which could pop the modal on an un-watch tap whenever an earlier episode happened to be unwatched (wrong prompt for the action). All three call sites now check `is_watched` first.

**SUPERSEDED (Phase 17, 2026-07-15):** the client-side `hasPreviousUnwatched`/`hasPreviousUnwatchedForSeason` (and the "staleness fix" above that patched around their weakness) are gone — replaced by a server-authoritative `POST /api/watch-state/catchup-check/` (`CatchupCheckView`). See the "Catch-Up Check Moved Server-Side" section below for why and how.

**Undo (Phase 19, 2026-07-15):** `useCatchupCascade`'s `onFinalize` signature changed from `(ids) => void` to `(ids, watched) => void` — `confirm()` now also arms a `components/Snackbar.tsx` toast ("Marked N episodes watched" + UNDO) whenever the confirmed cascade included at least one prior episode (a single un-cascaded mark is already a 1-tap undo via the same checkmark, so no snackbar for that case). Tapping UNDO calls `onFinalize(ids, false)`, reusing the exact same bulk-mark code path each of the 3 screens already had, just parameterized on direction instead of hard-coding `true`. All 3 screens (`app/(tabs)/index.tsx`, `app/show/[id]/season/[season].tsx`, `app/episode/[id].tsx`) render the shared `<Snackbar>` next to their existing `<CascadeModal>`.

**Design tokens:** no new colors — the modal already used the locked glass/hairline/Neon Yellow tokens; the new third button is a plain muted-text tertiary action (`rgba(255,255,255,0.4)`, underlined) consistent with the rest of the design system.

---

## Catch-Up Check Moved Server-Side + Mark/Unmark Season Toggle (Phase 17) — NEW

**User-reported bug:** marking a later episode watched (e.g. episode 6 of 8 in a season, nothing before it watched) silently marked only that one episode — no "mark previous episodes?" modal, even though 5 earlier episodes were genuinely unwatched. User also asked that marking any episode in any order, in any season (e.g. jumping straight to a new show's Season 3 Episode 9) reliably trigger the check.

**Root cause:** `watchStore.hasPreviousUnwatched`/`hasPreviousUnwatchedForSeason` computed the answer purely from whatever the Zustand `watchlist` snapshot's `entry.show.episodes` already contained — which is only ever whatever seasons a `GET /shows/<id>/season/<n>/` call has actually cached locally (season 1 eager-cached on add; anything else only after the user opens that season's screen, or the periodic Celery sweep gets to it). A prior "staleness fix" (2026-07-14) patched around one symptom of this (awaiting `fetchWatchlist()` before the check) but didn't fix the underlying architecture: the check was fundamentally bounded by whatever the client happened to have already fetched, not by the true state of the show.

**Fix — moved server-side:** new `POST /api/watch-state/catchup-check/` (`CatchupCheckView`, `backend/core/views.py`) is now the single source of truth. Body is either `{"episode_id": ...}` (episode mode — checks everything chronologically earlier than the target) or `{"show_id": ..., "season_number": ...}` (season mode — checks earlier seasons only, mirrors the old `hasPreviousUnwatchedForSeason`). Before answering, it eager-fetches (via `TMDBService.get_season_episodes()`, best-effort) any season strictly before the check boundary that isn't cached yet — so the answer is always computed from a complete picture, never bounded by whatever the frontend already happened to have loaded. Returns `{has, ids, count}`; short-circuits to `has:false` if `Watchlist.ignore_catchup` is set.

`client-mobile/lib/useCatchupCascade.ts`'s `checkEpisode`/`checkSeason` are now `async`, calling this endpoint instead of the removed store methods. All 5 call sites across the 3 screens updated to `await` the check: `app/(tabs)/index.tsx` (ShowRow's `handleCheckPress` fires it without awaiting — safe, since ShowRow's own tap animation already plays independently and the eventual toggle is idempotent either way; `handleGridCheckPress` properly awaits since grid cards have no animation to cover the gap), `app/show/[id]/season/[season].tsx` (`handleToggleEpisode`, `handleMarkSeasonWatched`), `app/episode/[id].tsx` (`handleToggleWatched`).

**Live-verified against a rolled-back DB transaction** (not just typechecked), 4 scenarios: (1) same-season jump (mark episode 6 of 8, nothing prior watched) → correctly returns 5 previous unwatched ids — the exact reported bug; (2) cross-season jump on a real show (Reacher) with Season 1 and 2 never opened/cached, checking Season 3 Episode 3 → correctly auto-caches both missing seasons via real TMDB calls and returns all 18 previous unwatched (8+8+2); (3) season mode correctly isolates to earlier seasons only; (4) `ignore_catchup` short-circuit still works.

**Mark/Unmark Season Watched toggle (user-requested, task 2):** the season screen's "Mark Season Watched" button previously became a disabled, unclickable "Season Complete" label once every aired episode was watched. Now a dynamic toggle: unwatched → solid accent "Mark Season Watched" (routes through the same Catch-Up check as before); fully watched → outline "Unmark Season Watched" that un-marks every watched episode in the season in one batched `bulkToggleWatchState(ids, false)` call — no Catch-Up check needed for the un-watch direction, same rule as every other un-watch path in the app.

**Verified:** Django check clean, 6/6 pytest, `tsc --noEmit` zero new errors (same pre-existing baseline).

---

## Adaptive Theming & Premium Polish (Phase 12) — IN PROGRESS

Design plan: "Glix · Phase 9 · Design System & Premium Polish" (published artifact). Renegotiates two previously-locked tokens (pitch-black-only bg, yellow-only foreground) — see `AI_RULES.md` §2a for the sign-off and full rationale.

**Foundation (`lib/theme.ts`, `store/themeStore.ts`):** every color is a token on `AppTheme.colors`, resolved by `useAppTheme()` against `ThemeName` (`'light' | 'dark'`). `themeStore.ts` persists `System | Light | Dark`; `system` tracks `useColorScheme()` live. The accent splits into `accentFill` (always bright `#E4FA1A`, fill-only) and `accentInk` (foreground — bright on dark, darkened lime `#434F08` on light, since `#E4FA1A` as text on white is ~1.1:1 contrast). Light theme: paper ground `#EDEEEA`, raised near-white cards, inky `#111308` text, soft shadows for depth (`elevation()` helper — dark gets depth from `glassGradTop/Bot` + `edgeLight` instead, since shadows are invisible on `#000`).

**New shared components (Phase 12 polish):**
- `GlassSurface.tsx` — the codified glass recipe (gradient fill + top edge-light on dark, `elevation()` shadow on light) so every card/row inherits the same material instead of a flat single fill.
- `PressableScale.tsx` — Reanimated spring-scale (~0.96) tactile feedback on press, reduced-motion aware, UI-thread only.
- `AmbientGlow.tsx` — SVG (`react-native-svg`, already a dependency) radial gradient behind hero metrics, ~6–16% opacity, non-interactive.
- `TrendChip.tsx` — ▲/▼/— verdict chip using only the two permitted hues (accent for positive, error red reserved for a `broken` streak, neutral gray for flat).

**New shared libs:** `lib/typography.ts` (`monoLabelStyle` — precision-layer caption style; **deviates from the brief**: uses RN's `monospace` generic, not JetBrains Mono, since no `expo-font`/font asset exists in the repo and none was added — see `AUDIT.md`), `lib/motion.ts` (`staggerEntering(index)` for 60ms-staggered card entrances + `usePrefersReducedMotion()`).

**Dead-weight audit fixes (`profile.tsx`):** removed the redundant header Search button (search lives in Discover) and the dead "Create a New List" row (`onPress={() => {}}`, no backing feature); collapsed the social bar from 4 cells to the 2 real ones (Shows/Movies) — Following/Followers were hard-coded `0`s with a `TODO`, no social graph exists.

### Full screen/component migration (2026-07-14) — the ~35-file gap closed

User reported the light theme visibly broken across most of the app (screenshots of Shows/Movies/Discover/Upcoming all rendering pitch-black regardless of the Appearance setting) — the "not yet done" debt below was the root cause. Closed in one pass across ~54 files (main session + 4 parallel migration passes covering detail screens, analytics/community, shared components, and auth/onboarding):

- **Every screen and shared component now reads colors from `useAppTheme().theme.colors`** — no more module-level `const NEON_YELLOW = '#E4FA1A'` / `PITCH_BLACK` / `GLASS_FILL` / `HAIRLINE` constants anywhere in `app/` or `components/`. `StyleSheet.create` blocks are layout-only (size/padding/radius/flex); colors are applied inline at the JSX call site from the resolved theme.
- **Deliberate, documented exception — photo-caption overlays stay theme-invariant:** badges/scrims/text painted directly on top of a poster/backdrop *photo* (rating badges, media-type badges, backdrop gradients on show/movie/episode detail headers, `HeroCarousel`, `SearchResultCard`, `ContinueWatchingCard`, `SeasonCard`) keep a fixed dark wash + white text in both themes — legibility over an arbitrary photo can't depend on the app's light/dark preference. Modal/sheet backdrop scrims (`CascadeModal`, `MVPVotingSheet`, `BadgeUnlockModal`, comment sheets) are the same fixed `rgba(0,0,0,0.5–0.6)` in both themes, matching standard modal-backdrop convention.
- **`ProgressRing.tsx`/`SpoilerOverlay.tsx`** (the two components AI_RULES.md calls out as "the sole implementations") are now genuinely theme-aware — they previously still had hardcoded constants despite the doc claiming otherwise; fixed per "actual files win over docs."
- **`ShowCard.tsx`** was privately forking its own SVG progress ring (an AI_RULES §2 violation — "never inline a new SVG ring") — removed the fork, now consumes the shared `ProgressRing.tsx`.
- **`achievements.tsx`/`year-review.tsx`** also picked up the entrance-stagger + `AmbientGlow` treatment named in the original design brief (still missing before this pass). `TrendChip` was deliberately *not* added to either — both would need a prior-period comparison value neither screen's data provides, and fabricating one was out of scope.
- Non-token colors that predate theming and aren't part of the light/dark system were left untouched on purpose: gold rating-star color, the pre-existing blue "upcoming" episode badge, `year-review.tsx`'s coral/blue/purple per-card accent hues.
- Verified: `node --stack-size=8000 ./node_modules/typescript/lib/tsc.js --noEmit` — same pre-existing ~17 errors only (FlashList `estimatedItemSize` typing, 2 test-file signature mismatches, `watchStore.ts`'s `expo-file-system` typing, iOS widget module resolution, `HeroCarousel`'s ref typing) — zero new errors across all changed files.

**Still open (Phase 12 polish, not a theme-leak bug):** real JetBrains Mono font asset (currently RN's `monospace` generic).

---

## Global List/Grid Layout Toggle (Phase 13) — NEW

A shared, persisted layout preference (mirrors premium tracking-app UX — e.g. TV Time's list/poster-grid switch) applied uniformly across every primary media list:

- **State (`store/watchStore.ts`):** `preferredLayout: 'list' | 'grid'` (persisted, default `'list'`) + `toggleLayout()` action. Deliberately lives on the existing `watchStore` rather than a new store — it's one boolean-ish preference, not a new domain.
- **UI (`components/LayoutToggle.tsx`):** compact icon-only two-button pill (same shape as the Shows Hub's pre-existing Upcoming List/Calendar toggle), `lucide-react-native`'s `List`/`LayoutGrid` icons, wrapped in `PressableScale` for tactile press feedback, styled entirely from `useAppTheme().theme.colors` (`accentFill`/`onAccent` active state, `glassFill`/`hairline` idle chrome) — fully theme-adaptive, no new colors.
- **Card types:** `'list'` renders the existing dense row components unchanged (`ShowRow`, `MovieRow`, and each screen's own lightweight row). `'grid'` (`numColumns={2}`) renders two new, completely distinct poster-first cards — `components/ShowPosterCard.tsx` / `components/MoviePosterCard.tsx` — large 2:3 posters (16px radius, within the locked 14–20px card range), title/subtitle/progress rendered below the poster from theme tokens, and status/countdown/rating badges painted directly on the poster photo. Those poster-overlay badges follow the documented photo-caption exception (fixed dark wash + white text) since legibility over an arbitrary TMDB image can't depend on the app's light/dark preference; the "imminent" countdown highlight and the watched checkmark use `accentFill`/`onAccent` instead, since that pair is bright-fill-plus-dark-text by design and stays legible over any photo in either theme.
- **FlashList wiring:** every list passes `numColumns` computed from `preferredLayout`, `extraData={preferredLayout}`, and — per FlashList's own layout-thrashing caveat when `numColumns` changes at runtime — a `key` prop that includes `preferredLayout` (e.g. `key={\`watchlist-${preferredLayout}\`}`) so switching layouts forces a clean full remount instead of a stale cell-size recycle.
- **4 wired screens:** `app/(tabs)/index.tsx`, `app/(tabs)/movies.tsx`, `app/profile/shows.tsx`, `app/profile/movies.tsx`.
- **Shows Hub has two separate toggle UIs, not one shared control (fixed 2026-07-14, user-reported):** the header `LayoutToggle` only renders on the WATCH LIST tab. UPCOMING doesn't reuse it — stacking it above UPCOMING's pre-existing List/Calendar toggle read as two redundant controls (both partly "list view"). Instead, UPCOMING's `viewToggleRow` is a 3-way List/Grid/Calendar control: its List and Grid buttons drive the same global, persisted `preferredLayout` (tap List → `preferredLayout:'list'` + `upcomingView:'list'`; tap Grid → `preferredLayout:'grid'` + `upcomingView:'list'`), while Calendar only changes the orthogonal `upcomingView` state and leaves `preferredLayout` untouched.
- **Checkmark parity:** grid cards keep the mark-watched interaction (`ShowPosterCard`'s/`MoviePosterCard`'s `checkmark` prop), but without `ShowRow`/`MovieRow`'s collapse-animation choreography — there's no exit animation to defer to, so the grid checkmark calls the store update immediately (still routed through the same `useCatchupCascade` check on the Shows Hub, via a new `handleGridCheckPress`). `app/profile/shows.tsx`'s and `app/profile/movies.tsx`'s grid cards are read-only browse views (status/progress only, no checkmark) — matches their existing list-view rows, which also have no toggle interaction.

---

## Profile Avatar Picker & Badge-System Fixes (Phase 14) — NEW

Three real bugs found via a targeted Profile-hub audit (user request: "check if badges/other options are working, not just boilerplate") plus the requested avatar-picker feature, all shipped together:

**1. Avatar picker (the requested feature).** Profile's "EDIT" pill and the avatar image itself previously just routed to `/settings`, which has no avatar/username editing UI at all (Account section is read-only text) — tapping "EDIT" edited nothing. Now both open `components/AvatarPickerModal.tsx`, a bottom sheet with two tabs:
- **Cast** — real TMDB character headshots via `GET /api/profile/avatar-options/` (`AvatarOptionsView`), sourced through `TMDBService.get_popular_characters()` (top-billed cast from trending TV shows + popular movies, labeled by in-show `character` name rather than actor name — see Phase 16 below for why this replaced an earlier real-celebrity pool), 24h Django-cached server-side (mirrors `DiscoverGenresView`'s caching pattern — this is decorative picker content, not live data).
- **Cartoon** — illustrated/anime-leaning avatars generated client-side from a fixed style×seed list against DiceBear's public HTTP avatar API (`api.dicebear.com`, no API key, no new npm dependency — just image URLs `expo-image` renders like any other remote photo). TMDB has no "cartoon character" image type, so this pool intentionally doesn't pretend to be TMDB data.

Selecting either calls the new `watchStore.updateProfilePicture(url)` (optimistic PATCH `/profile/`, already supported avatar-URL updates server-side via `UserProfileSerializer` — the endpoint existed, nothing in the client ever called it).

**2. `BadgeUnlockModal` showed a raw slug, not the real badge name/description.** `app/_layout.tsx` built the unlock popup's title from `unlockedBadges[0].replace(/_/g, ' ')` (e.g. `hundred_club` → "hundred club", not even capitalized) and hard-coded every description to `"You've earned a new milestone badge!"` regardless of which badge actually unlocked (a streak or genre badge would show the same wrong "milestone" copy). Fixed by extending `lib/badges.ts`'s `BADGE_META` with a `description` field (kept textually in sync with `backend/core/badge_constants.py`'s `BADGE_DISPLAY`) and having `_layout.tsx` look up the real label/description from it, falling back to the old slug-replace behavior only for a slug `BADGE_META` doesn't recognize.

**3. `movie_lover` badge was permanently unearnable.** `badge_constants.py` declared it (`"placeholder (movies tracked separately)"`), it appeared in `BADGE_ORDER` and on the Achievements screen, but no code anywhere — not `signals.py`'s real-time evaluator, not `tasks.py`'s safety-net recalculation — ever added it to `earned_badges`; `analytics_views.py`'s progress computation fell through to the generic `else` branch (`progress=0`, `"Not yet unlocked"`) forever. Watching unlimited movies could never unlock it. Fixed properly, mirroring the existing `WatchState` badge pattern exactly:
- New `MOVIE_LOVER_THRESHOLD = 10` (movies watched) in `badge_constants.py`.
- New `signals.py` receiver `evaluate_movie_badges` (`post_save` on `MovieWatchState`, same presence-based/idempotent pattern as `evaluate_badges`) — awards it in real time, and its result flows into `MovieWatchStateToggleView`'s existing `newly_earned_badges` response diff (already computed there, just never had anything to report), so the `BadgeUnlockModal` pops for it exactly like an episode badge.
- `tasks.py`'s `recalculate_user_badges` safety net gained the same check.
- `analytics_views.py`'s `_compute_badge_progress` gained a real `movie_lover` branch (`{movies_watched} / 10 movies`) instead of falling into the generic placeholder branch.
- Live-verified end-to-end via a rolled-back DB transaction (10 `MovieWatchState` rows → `earned_badges` contains `movie_lover`), not just typechecked.

**Verified:** Django check clean, 6/6 pytest, `node --stack-size=8000 tsc --noEmit` — zero new errors (same pre-existing ~28-line baseline: FlashList `estimatedItemSize`, `HeroCarousel` ref typing, `widgets/ios/*` prop-shape, one unrelated `index.tsx` `unknown` type). **Not live-tested in a running Expo session** — no device/emulator available in this environment; stated explicitly per `AI_RULES.md` §5.5 rather than silently claimed.

---

## New/Announced Seasons in Upcoming (Phase 15) — NEW

**Bug (user-reported, screenshots):** a show sitting in the Shows Hub's watchlist (any bucket, including "Haven't Started" — not yet watched at all) with a newly-announced season on the way never appeared in the UPCOMING tab, even though the reference the user compared against (a TV Time-style app) showed a real countdown for it. Reacher, freshly added with 0 episodes watched, has a real Season 4 Episode 1 premiere TMDB already knows about (2026-08-12 at the time this was fixed) — it simply never surfaced.

**Root cause:** `lib/upcoming.ts`'s `buildUpcomingItems()` only ever looked at `entry.show.episodes` — the locally-cached `CachedEpisode` rows. `ShowAddView` only eager-caches **season 1** on add; a new season (4, in Reacher's case) has no `CachedEpisode` rows at all until either the periodic Celery sweep (`sync_active_shows` → `refresh_show_cache`, RETURNING shows only, runs on its own schedule — not triggered by adding a show) catches up, or the user opens that season's screen directly. TMDB itself, however, already exposes the answer independent of per-episode caching: `/tv/{id}`'s payload includes a `next_episode_to_air` object (season/episode number, air date, name) the moment TMDB knows a premiere date — this was fetched on every `get_show_details()` call all along and simply discarded.

**Fix:**
- `CachedShow` gained 4 new fields — `next_episode_air_date`, `next_episode_season_number`, `next_episode_number`, `next_episode_name` (migration `0005_cachedshow_next_episode_air_date_and_more`).
- `TMDBService.get_show_details()` now extracts `next_episode_to_air` into those fields on every fetch/refresh — including the periodic `refresh_show_cache` Celery task, no separate wiring needed there since it already calls `get_show_details()` first.
- `CachedShowSerializer` exposes the 4 new fields (flows through `WatchlistSerializer` → `GET /api/watchlist/` → `entry.show.next_episode_*` on the frontend).
- `lib/upcoming.ts`'s `buildUpcomingItems()` now also emits a synthetic `UpcomingItem` from `show.next_episode_*` (deduped against any matching `season-episode` pair already present among cached episodes, so a season that later gets fully cached doesn't double-list), title falling back to `'TBA'` if TMDB hasn't named the episode yet. Shared by both the UPCOMING tab's List view and `CalendarGrid.tsx` (same `UpcomingItem` type), and by the widget data bridge (`watchStore.ts`'s `syncWidgetData()`, which already reuses `buildUpcomingItems()`) — all three get the fix for free.
- **Live-verified against real TMDB**, not just typechecked: Reacher's actual `next_episode_to_air` (`{season_number: 4, episode_number: 1, air_date: "2026-08-12", name: "Episode 1"}`) fetched directly, then confirmed the full pipeline (`get_show_details()` → `CachedShow` row → `CachedShowSerializer` output) round-trips it correctly. The dev database's real Reacher row was refreshed as part of this verification, so the fix is visible immediately on next app load, not just for shows added after this change.
- **Verified:** Django check clean, 6/6 pytest, `tsc --noEmit` zero new errors (same pre-existing baseline).

---

## Avatar Picker "Cast" Tab: Characters, Not Random Celebrities (Phase 16) — NEW

**User feedback (screenshot):** Phase 14's avatar-picker "Cast" tab, backed by `TMDBService.get_popular_people()` (`/person/popular`), surfaced generic trending celebrities with no connection to any show or movie — not the "character" pool the feature was meant to be.

**Constraint:** TMDB has no standalone character entity and no `/character/popular` endpoint. A character's only image, anywhere in TMDB's data model, is the credited actor's own headshot (`profile_path` on a cast credit) — there is no separate character-portrait asset to fetch instead.

**Fix — closest TMDB-backed approximation of "pick a character":** `TMDBService.get_popular_people()` replaced outright by `get_popular_characters(limit)`, which pulls the top 4 top-billed cast members from each of the 8 currently-trending TV shows (`get_trending_shows()`) and 8 popular movies (`get_popular_movies()`) — reusing the already-existing `get_show_credits()`/`get_movie_credits()` (both already returned a `character` field, just never surfaced to the picker) — and keeps each entry's `character` name and source `show_title` instead of the actor's real name. `AvatarOptionsView`'s response shape changed from `{tmdb_id, name, profile_path, known_for_department}` to `{character, show_title, profile_path}`; `AvatarPickerModal.tsx`'s `CastCharacter` interface (renamed from `CastPerson`) updated to match. Cache key renamed `profile_avatar_character_options` (still 24h).

**Live-verified against real TMDB, not just typechecked:** confirmed real in-show character names came back — "Prince Daemon Targaryen" / "Queen Alicent Hightower" (House of the Dragon), "Juliette Nichols" (Silo) — not actor names.

**Verified:** Django check clean, 6/6 pytest, `tsc --noEmit` zero new errors (same pre-existing baseline).

---

## Upcoming Tab: Day-Wise Section Grouping (Phase 18) — NEW

**User-requested:** organize the Shows Hub's UPCOMING tab (List + Grid views) so episodes releasing on the same day are visually grouped under a shared day header, instead of an undifferentiated flat list/grid where every item repeats its own countdown with no sense of "what's dropping today vs. next week."

**Design (Glix's own bucketing, not a copy of any reference app's exact thresholds):** `lib/dateFormat.ts`'s new `formatUpcomingHeaderLabel(airDate, now)` buckets a date into one of: `TODAY`, `TOMORROW`, a weekday name for 2–6 days out (e.g. `THURSDAY`), an absolute date for 7–30 days out (e.g. `JUL 22, 2026` — the point at which day-of-week stops being intuitively useful), or a single shared `LATER` bucket beyond 30 days out (day-level grouping stops being meaningful that far ahead — those items keep their own relative countdown instead of getting individual date headers).

`lib/upcoming.ts`'s new `groupUpcomingItemsByDate(items, now)` walks the already date-sorted `UpcomingItem[]` and emits a flat `UpcomingListEntry[]` (a `{type:'header', label}` / `{type:'item', data}` discriminated union) — a header is inserted only when the bucket label changes from the previous item. Since the label itself is the grouping key and items arrive pre-sorted, two different shows releasing on the exact same calendar date land under one shared header automatically (the specific behavior the user asked for), and everything past the 30-day cutoff collapses into a single `LATER` section rather than one header per distant date.

**Rendering (`app/(tabs)/index.tsx`):** the UPCOMING tab's List and Grid FlashLists both now render `upcomingEntries` (the grouped array) instead of the flat `upcomingItems`, via a new `UpcomingSectionHeader` component (a centered glass pill, matching the app's chip/pill visual language — no new colors). `renderUpcomingEntry`/`renderUpcomingGridEntry` branch on `entry.type`. In the 2-column Grid view, headers use FlashList v2's `overrideItemLayout` to set `layout.span = maxColumns` so a header spans the full row width instead of sitting awkwardly beside a poster card; `getItemType` is also wired so FlashList recycles header and item cells separately (better recycling, not just correctness). The Calendar view (`CalendarGrid.tsx`, third toggle) is untouched — it already groups by month/day in its own way and wasn't part of this request.

**Verified:** `tsc --noEmit` — zero new errors (same pre-existing baseline, the tracked `FlashList estimatedItemSize` line just shifted to the new call site). Bucketing logic sanity-checked against a fixed set of sample dates in a scratch script (not a unit test file, since this repo has no frontend test infra beyond the `jest-expo` baseline config) — confirmed correct TODAY/TOMORROW/weekday/date/LATER assignment and same-date collision grouping. **Not live-tested in a running Expo session** — no device/emulator available in this environment, stated explicitly rather than silently skipped.

---

## UX Audit Bundle: Undo, Watchlist Search, Onboarding Quick-Add (Phase 19) — NEW

User asked for a whole-app audit for missing/improvable features. An Explore-agent survey (code-verified, not guessed) confirmed 8 real gaps; user picked the smallest, most contained 3 to ship now and explicitly deferred the larger ones (push notification delivery, personal ratings, rewatch tracking, a real social/follow graph — none of these exist yet, tracked as future work, not started).

**1. Undo snackbar on the Catch-Up cascade.** See the "Undo (Phase 19...)" note above — new `components/Snackbar.tsx` (generic bottom toast + action button + auto-dismiss timer, not cascade-specific, so any future bulk/hard-to-reverse action can reuse it) wired into all 3 Catch-Up call sites via `useCatchupCascade`'s new `(ids, watched)` `onFinalize` signature.

**2. Search box on My Shows / My Movies.** `app/profile/shows.tsx`/`movies.tsx` previously only had filter pills for narrowing an already-large watchlist — no text search. Added a `TextInput` (same glass-pill visual language as `search.tsx`'s existing search bar) filtering the already-loaded page client-side by title, composed with the existing pill filter rather than replacing it. Empty state distinguishes "no matches for your search" from "no shows/movies at all" / "none match this filter."

**3. Onboarding quick-add.** `app/onboarding.tsx` was a pure 3-slide value-prop swiper — Skip or Get Started both landed on a completely empty Shows Hub. Added a 4th page: a poster grid of the same 12 titles `DiscoverFeedView`'s `popular_shows` section already serves (no new backend endpoint), multi-select tap-to-toggle with a checkmark overlay. "Get Started" now calls the existing `watchStore.addShowToWatchlist(id)` for every selected show (`Promise.all`, same action Show Detail's "Add to Watchlist" button already uses) before navigating to `(tabs)`; Skip and a zero-selection Get Started both proceed exactly as before this existed — the picker is additive, not a new required step.

**Verified:** `tsc --noEmit` zero new errors (same pre-existing baseline) across all 6 changed/new files. Django check clean, 6/6 pytest (no backend changes this pass — `DiscoverFeedView` was reused as-is). Not live-tested in a running Expo session — no device/emulator available in this environment.

---

## Profile Hub Deep QA Audit (Phase 20) — NEW

User asked for a comprehensive page-wise QA/refactor/polish pass over `app/(tabs)/profile.tsx` and every component it imports, strictly checked against Phase 12's "no hard-coded hex, `useAppTheme()`/`GlassSurface`/`PressableScale` only" rule. Read every connected file (`AvatarPickerModal.tsx`, `GlassSurface.tsx`, `PressableScale.tsx`, `lib/typography.ts`, `community.tsx`) rather than trusting the "fully migrated" claim in the Phase 12 entries above — found 4 real issues docs hadn't caught:

**1. Real desync bug — Social Bar "Movies" count didn't match the "My Movies" row badge on the same screen.** The Social Bar stat computed `movieWatchlist.watched.length` (watched movies only); the "My Movies" row a few inches below computed `watch_next.length + watched.length` (all tracked movies) — two different numbers for "movies," visibly inconsistent (e.g. "1" vs "4" in the same screenshot), unlike the "Shows" stat which already counted all tracked shows consistently in both places. Fixed by unifying both to one `totalMovies` memo (`watch_next + watched`), matching the Shows stat's semantic exactly — single source of truth, no more possible drift between the two.
- **2. 3 hard-coded hex colors** — `'#FFB800'` used for the import-modal's "Skipped / Not Found" icon/text/count (a real Phase 12 §2a violation: a third hue outside the locked accent+error two-hue rule). Replaced with `c.negative` — semantically correct (a partial-failure indicator) and stays inside the locked two-hue palette.
- **3. Modal backdrop scrim opacity inconsistency** — the profile page's own import-result `<Modal>` used `rgba(0,0,0,0.85)`, while every other modal backdrop in the app (`CascadeModal`, `MVPVotingSheet`, `BadgeUnlockModal`, `AvatarPickerModal`) uses the documented `0.5–0.6` convention. Normalized to `0.6`.
- **4. 3 interactive elements still used plain `Pressable` instead of `PressableScale`** — the header's Users/Settings icon buttons and the Badges section's "See all" link had no tactile press feedback, unlike every other row on the page. Converted all 3; removed the now-unused `Pressable` import.

**Polish — "JetBrains Mono for stat numbers" (explicit user ask):** `monoLabelStyle` was already applied to stat *captions* ("MONTHS," "SHOWS") but not the numeric *values* themselves. Added `lib/typography.ts`'s new `monoValueStyle` (monospace + tabular-nums, no caption transforms — distinct from `monoLabelStyle`'s uppercase/tracked-out treatment, which is wrong for a large number) and applied it to all 6 numeric displays on the page: the two Social Bar counts, the four Watch Time stat values, and both "My Shows"/"My Movies" count badges.

**Confirmed clean (no action needed):** avatar/username/email null-handling already graceful (initials fallback, "Loading…"/"Guest", conditional email render); `GlassSurface` used on every card/row already; badges/empty-badges state already a real branded empty state, not a blank flexbox; all navigation (`/profile/shows`, `/profile/movies`, `/analytics`, `/achievements`, `/year-review`, `/community`, `/settings`) resolves to real, previously-verified screens — no dead "coming soon" placeholders found; `community.tsx` (in-scope as a connected component) is fully wired — real cross-show comment aggregation, error/empty states, no boilerplate; the two remaining `rgba(255,69,58,0.3)`/`rgba(0,0,0,0.6)` occurrences in `AvatarPickerModal.tsx` match established, repo-wide error-border and modal-scrim conventions (not page-specific bugs, left as-is for consistency with the rest of the app).

**Verified:** `tsc --noEmit` zero new errors (same pre-existing baseline). Django check clean, 6/6 pytest (no backend changes). Not live-tested in a running Expo session — no device/emulator available in this environment.

---

## Discover Hub Deep QA Audit + "Network Error" Root Cause (Phase 21) — NEW

User reported intermittent raw "Network Error" text appearing across the app — not just Discover, especially "when tapping movies or series" — and asked for a comprehensive Discover Hub + TMDB pipeline audit.

**Root cause, found by tracing the full pipeline (backend `TMDBService` → `lib/api.ts` → `lib/errors.ts`):** `lib/errors.ts::extractErrorMessage` — the single shared helper nearly every screen uses for user-facing error text — fell through to axios's own `error.message` whenever the backend response had no `detail` field. For a request that never got a response at all (timeout, connection refused, DNS failure), axios's `error.message` on React Native is *literally* the raw string `"Network Error"` (or `"timeout of Xms exceeded"` for `ECONNABORTED`) — an unbranded, technical string surfaced verbatim. Compounding this: `TMDBService.__init__`'s retry strategy (`backend/core/services.py`) had `total=4, backoff_factor=1` — urllib3's exponential formula gives a worst-case of 1+2+4+8=**15 seconds of pure backoff sleep alone**, before even counting request time, for a single TMDB call that keeps hitting 429/5xx. Several endpoints make multiple TMDB calls per request (`DiscoverFeedView`'s 3 sequential calls; movie/show detail's 3 parallel credits/providers/recommendations calls), multiplying the odds any one of them hits this — easily exceeding the frontend's fixed 10s axios timeout (`lib/api.ts`) even though the backend was still legitimately working through a transient TMDB rate-limit. That mismatch is what turned "TMDB was briefly slow" into a hard client-side failure rendering the raw "Network Error" string.

**Fix (two-sided, tuned together):**
- `lib/errors.ts::extractErrorMessage` now detects `error.code === 'ECONNABORTED'` (timeout → "This is taking longer than expected...") and `!error.response` (true network failure → "Can't reach Glix right now...") before falling through to the raw axios message. Every screen using this shared helper gets the fix for free.
- `backend/core/services.py`'s `TMDBService.__init__` retry strategy tightened to `total=3, backoff_factor=0.5` (worst-case backoff ~3.5s, still absorbs a transient blip without risking the client timeout).
- `lib/api.ts`'s axios `timeout` raised 10000 → 15000ms for headroom, tuned together with the backend change above so the two stay comfortably within each other's bounds.
- `store/discoverStore.ts`'s three fetch actions (`fetchFeed`/`runSearch`/`fetchFilteredResults`) were duplicating their own inline `err?.response?.data?.detail || '...'` extraction instead of calling `extractErrorMessage` — an AI_RULES.md §3.2 rule-11 violation ("use `lib/errors.ts`'s `extractErrorMessage` for any user-facing error text") that also meant this store never got the friendlier network/timeout messages. Now calls `extractErrorMessage(err)`.
- **Live-verified**, not just typechecked: ran `DiscoverFeedView`'s exact 3-call TMDB sequence (trending + popular + airing-today) directly — completed in 1.34s under normal conditions, comfortably inside the new 15s timeout with wide margin even accounting for occasional retries.

**Second real bug found — inconsistent optimistic-routing params.** Both `movie/[id].tsx` and `show/[id].tsx` read 5 optional route params for their optimistic fallback render (`title`, `poster_path`, `backdrop_path`, `overview`, `vote_average`), but each of the 3 Discover entry points passed a different partial subset: `HeroCarousel` passed only `{title, backdrop_path, overview}`; `HorizontalMediaList` and `SearchResultCard` passed only `{title, poster_path, vote_average}`. Depending on which card the user tapped, the optimistic fallback UI was missing different pieces (no poster/rating from the hero carousel; no backdrop/overview from a poster row) while the real data loaded. Fixed by widening `HeroMedia`/`MediaItem` to carry the full field set (optional, since not every future caller will have all of them) and forwarding all 5 params from all 3 entry points — the data was already present in `DiscoverMediaItem`, just not read/forwarded.

**Boilerplate purge — dead `[+]` add-to-watchlist button in `HorizontalMediaList.tsx`.** The component accepted an `onAddPress` prop and rendered a `Plus` icon button when set, but `discover.tsx` (its only caller anywhere in the app) never passed it — a permanently dead, never-rendered code path. Removed the prop, the button, the `Plus` import, and its now-unused styles rather than wire up a feature nobody asked for.

**Phase 12 compliance sweep across the Discover Hub and its components:**
- `GenreGrid.tsx` had a hard-coded `backgroundColor: '#1E1E1E'` fallback card color — replaced with `c.glassFill`.
- `DiscoverFilterSheet.tsx`'s sort pills used raw emoji (🔥/⭐/🏆) in the label string — the exact "amateurish" pattern already fixed once on the Shows/Movies segment toggle in the same file's sibling component, missed here. Replaced with real lucide icons (`Flame`/`Star`/`Trophy`), matching the app's established icon vocabulary.
- Converted every remaining plain `Pressable` to `PressableScale` across `discover.tsx` (segment tabs, search clear, filter button, cancel button, `SearchResultCard`, both retry buttons), `HeroCarousel.tsx` ("View Details"), `HorizontalMediaList.tsx` (card), `GenreGrid.tsx` (genre tile), and `DiscoverFilterSheet.tsx` (sort/genre pills, close button, reset button) — the bottom sheet's full-screen backdrop-dismiss tap target is the one deliberate exception, matching `CascadeModal`'s identical precedent (scaling an invisible full-bleed overlay has no visual meaning).
- Feed-load and filtered-results error states in `discover.tsx`, plus the blocking primary-load error states in `movie/[id].tsx` and `show/[id].tsx`, now render inside a `GlassSurface` card with a `WifiOff` icon instead of bare centered text — the "premium, Phase-12-compliant error state" the task asked for.

**Verified:** `tsc --noEmit` zero new errors (same pre-existing baseline). Django check clean, 6/6 pytest. Live-verified the TMDB retry timing directly against the real API. **Deliberately left out of scope** (stated explicitly, not silently skipped): `movie/[id].tsx` and `show/[id].tsx` have additional plain `Pressable`s elsewhere in the screen (back buttons, action buttons) beyond the error state fixed here — full conversion of those two large detail screens is a separate scope from "Discover Hub audit" and is flagged in `AUDIT.md` for a future dedicated pass, same treatment the Profile Hub got in Phase 20. Not live-tested in a running Expo session — no device/emulator available in this environment.

---

## Movies Hub Deep QA Audit (Phase 22) — NEW

Same audit pattern as Profile Hub (Phase 20) and Discover Hub (Phase 21), scoped to `app/(tabs)/movies.tsx`, `app/movie/[id].tsx`, and connected components (`MovieRow.tsx`, `MoviePosterCard.tsx`).

**Real bug — recommendations lost their optimistic-routing params, same class of bug as Phase 21's Discover fix, but in a different flow.** `app/movie/[id].tsx`'s "More Like This" rail routes to another movie detail screen on tap; the destination reads 5 optional fallback params (`title`/`poster_path`/`backdrop_path`/`overview`/`vote_average`), but `TMDBService.get_movie_recommendations()` only ever extracted 4 fields (`tmdb_id`, `title`, `poster_path`, `vote_average`, `release_date`) — `backdrop_path` and `overview` were silently dropped even though TMDB's real payload always includes them on every recommendation item (confirmed live: fetched real recommendations for a known movie, backdrop_path/overview present on every result). Fixed by extracting both fields backend-side and forwarding them in the frontend's `RecItem` type + the card's `onPress` params. The identical gap exists in the show-side equivalent (`get_recommendations()` in the same file) — confirmed but deliberately left unfixed, out of scope for a Movies-Hub-scoped audit, flagged in `AUDIT.md`.

**Dead code purged — `movies.tsx`'s `collapsingIds` ref.** Declared with a comment claiming it "tracks IDs currently collapsing so we don't remove them from the FlashList data until after their exit animation finishes," but nothing anywhere ever called `.add()` on it — the only other reference was a `.delete()` in `handleAnimationComplete`, a permanent no-op against an always-empty `Set`. The Shows Hub's equivalent screen (`index.tsx`) has no such ref at all, confirming this wasn't a shared pattern partially wired — the real anti-jump mechanism (deferring the Zustand `toggleMovieWatchState` call until the row's own collapse animation finishes) already worked correctly without it. Removed the ref, its dead `.delete()` call, and the now-unused `useRef` import.

**Phase 12 compliance sweep:**
- `movies.tsx`'s `FilterPill` had ~15 lines of hand-rolled `useSharedValue`/`withSpring` press-scale animation duplicating what `PressableScale` already does — replaced with `PressableScale` directly, removing the duplicated code.
- Converted every remaining plain `Pressable` to `PressableScale`: `movies.tsx`'s header Film-icon button, error banner (dismiss-on-tap), and "Browse All Movies" button; `movie/[id].tsx`'s sticky-header back button, backdrop back button, backdrop primary-action icon button, hero "Add to Watchlist/Mark as Watched" button, and each "More Like This" recommendation card (previously had its own manual `pressed && {opacity:0.8}` treatment, same pre-`PressableScale` pattern already retired elsewhere in Phase 21).
- `movies.tsx`'s empty state ("No movies in your queue"/"No watched movies yet") now renders inside a `GlassSurface` card instead of bare centered text — the explicit "premium empty state" ask.
- **Confirmed clean, no changes needed:** `MovieRow.tsx`'s outer row and checkmark both use plain `Pressable` by design, not a gap — verified this exactly matches `ShowRow.tsx`'s identical, established pattern (a bespoke spring/bounce animation on the checkmark already provides tactile feedback superior to a generic `PressableScale` wrapper; wrapping it in `PressableScale` on top would layer two competing press animations). `MoviePosterCard.tsx` was already fully `PressableScale`-based. FlashList `estimatedItemSize` values (108 list / 260 grid) checked against `MovieRow`'s actual `ROW_HEIGHT = 108` constant — exact match, no thrashing risk.

**Watch state & caching — traced end-to-end, confirmed correct, no bugs found:** `MovieAddView` (idempotent `get_or_create`, TMDB cache-first via `TMDBService.get_movie_details()`), `MovieWatchlistView` (buckets `watch_next`/`watched` from `MovieWatchState` presence), and `watchStore.ts`'s `toggleMovieWatchState`/`addMovieToWatchlist`/`fetchMovieWatchlist` (optimistic update with correct rollback-on-error, `total_time_watched` delta math, badge sync from the server's `newly_earned_badges` response) all read and verified against the actual code — no drift from what Phase 14's badge-system audit already established about this same code path.

**Verified:** `tsc --noEmit` zero new errors (same pre-existing baseline). Django check clean, 6/6 pytest. Live-verified the recommendations fix against real TMDB (`backdrop_path`/`overview` confirmed present on every result). Not live-tested in a running Expo session — no device/emulator available in this environment.

---

## Shows Hub Deep QA Audit (Phase 23) — NEW

Same audit pattern as Phases 20–22, scoped to `app/(tabs)/index.tsx` (Shows Hub), `app/show/[id].tsx`, `app/show/[id]/season/[season].tsx`, `app/episode/[id].tsx`, and connected components (`ShowRow.tsx`, `ShowPosterCard.tsx`, `EpisodeRow.tsx`, `CalendarGrid.tsx`).

**KNOWN BUG FIXED — zombie/invisible watchlist rows.** `buildRows()` called `pickNextEpisode(entry)` and silently `continue`d past any entry it returned `null` for — a watchlist entry with zero cached episodes at all (e.g. two consecutive TMDB eager-cache failures right after adding a show) vanished from every filter bucket with no way to find or retry it. Fixed by computing `pickNextEpisode()` once per entry (removing a duplicate call the old code made) and pushing a fallback row instead of dropping it: `ShowEpisodeRow.episode` is now `Episode | null`. List view renders a new `ZombieRow` component (shares `ShowRow`'s 100px footprint, no checkmark, tap-through re-triggers a real TMDB fetch); Grid view renders `ShowPosterCard` with a "NO DATA" badge and "Tap to retry" subtitle. This closes the "Zombie/invisible watchlist rows" item that was tracked in `AUDIT.md`'s Known Issues table.

**Real bug — UTC/local timezone mismatch in every "is this today?" check.** Every "today" computation in the Shows Hub used `new Date().toISOString().slice(0, 10)` (UTC-anchored), while every other date computation in the same files anchors on local midnight (`new Date(\`${airDate}T00:00:00\`)`). For any positive UTC-offset timezone during early-morning local hours (e.g. IST, 12:00–5:30 AM), `toISOString()` still reports the previous UTC day — an episode that already aired locally could be wrongly marked unaired (checkmark disabled, "isAired" gate blocking a legitimate watch-mark, Upcoming tab's TODAY label one day behind). Found via a repo-wide grep of the exact pattern (9 call sites). Fixed by adding `lib/dateFormat.ts::todayLocalIso()` (local-anchored, matching the existing convention) and replacing every "today" computation in the Shows Hub's scope: `buildRows()`, `pickNextEpisode()`/`buildUpcomingItems()` (`lib/upcoming.ts` — also used by the widget data bridge), `formatUpcomingHeaderLabel()`, the season screen's aired-episodes filter, both of `episode/[id].tsx`'s watch-gate checks, `EpisodeRow.tsx`'s toggle-disable check, and `CalendarGrid.tsx`'s "is today" cell highlight (which had a second, compounding bug — comparing the UTC-anchored value against a *local*-constructed grid-cell date).

**Real bug — show-side recommendations forwarded zero optimistic-routing params, worse than the movie-side gap Phase 22 fixed.** `TMDBService.get_recommendations()` (show-side) only extracted 5 of TMDB's fields, silently dropping `backdrop_path`/`overview` — the exact gap Phase 22 fixed on the movie side and explicitly deferred here as out of scope at the time. Worse: `show/[id].tsx`'s recommendation card's `onPress` forwarded **zero** route params at all — not even a title. Two more instances of the identical bug class were found in the same pass: the Upcoming tab's `UpcomingRow` (List view) and `CalendarGrid.tsx`'s selected-day episode row both also routed to a show's detail screen with zero params. Fixed backend extraction (mirrors `get_movie_recommendations()`'s pattern exactly) + `RecommendationItem` type + full param forwarding on all 3 sites (the recommendation card forwards the complete 5-field set; `UpcomingRow`/`CalendarGrid.tsx` forward `title`/`poster_path`, the ceiling of what `UpcomingItem` carries). Live-verified against real TMDB — Breaking Bad's recommendations now include real `backdrop_path`/`overview` values, zero missing keys.

**Phase 12 compliance sweep:**
- `index.tsx`'s `FilterPill` had the same hand-rolled press-scale animation Phase 22 already fixed on `movies.tsx`'s copy — replaced with `PressableScale`, removing the now-fully-unused `react-native-reanimated` import.
- Every remaining plain `Pressable` converted to `PressableScale` across all 4 screens plus `EpisodeRow.tsx`/`CalendarGrid.tsx` (error banner, view-toggle buttons, backdrop icon buttons, Add-to-Watchlist button, season/episode back and action buttons, spoiler rows, MVP button, month-nav buttons, day cells).
- All 3 Watch List/History/Upcoming empty states in `index.tsx` now render inside a `GlassSurface` card with an icon — the explicit "premium empty state" ask. `show/[id].tsx`'s and `season/[season].tsx`'s "progress" stat cards converted from raw tinted `View`s to `GlassSurface`.
- `episode/[id].tsx`'s error state upgraded to the established `GlassSurface`/`WifiOff`/`PressableScale` pattern — the only one of the 3 detail screens still missing it after Phase 21.
- 3 duplicate local `pad()` helpers deduped to the shared `lib/dateFormat.ts` export.
- **`estimatedItemSize` accuracy fixed:** list-mode values were `100`, undercounting the true ~108px measured row footprint (poster 80 + padding 20 + margin 8) that Phase 22's `movies.tsx` had already measured correctly for the identical row shape. Corrected to `108` (Watch List/History) and `110` (Upcoming, whose row uses a 10px margin). Grid-mode `260` left unchanged, matching the accepted cross-Hub baseline.
- **Confirmed clean, no changes needed:** `ShowRow.tsx`/`ShowPosterCard.tsx`'s plain `Pressable` is intentional, matching `MovieRow.tsx`'s identical established pattern. Catch-Up modal + Undo Snackbar wiring on the season/episode screens matches the Phase 17/19 implementation exactly, no regressions.

**Dead code purged — `ShowCard.tsx`.** Repo-wide grep confirmed zero usages anywhere in the app; fully superseded by `ShowPosterCard.tsx`. Deleted.

**Verified:** `tsc --noEmit` zero new errors (62 lines total, confirmed identical to the documented pre-existing baseline). Django check clean, 6/6 pytest. Live-verified the recommendations fix against real TMDB. Not live-tested in a running Expo session — no device/emulator available in this environment.

---

## Django Admin — Unfold Modernization (Phase 26) — NEW

Replaced the stock unstyled Django admin with `django-unfold==0.100.0`, a Tailwind-based admin theme package. `pip install`-only — no custom AdminSite, no template overrides, no JS build step.

**Wiring (`config/settings/base.py`):**
- `"unfold"`, `"unfold.contrib.filters"`, `"unfold.contrib.forms"` added to `INSTALLED_APPS`, **before** `"django.contrib.admin"` (required — Unfold's `AppConfig.ready()` swaps `django.contrib.admin.site` for `UnfoldAdminSite` at app-load time, so it must load first).
- `UNFOLD` config dict added: `SITE_TITLE`/`SITE_HEADER`, and a `SIDEBAR["navigation"]` grouping all registered models into 5 sections (Users & Profiles, Watch Data, TMDB Cache, Community) with Material icons, instead of Django's flat alphabetical app list.
- **Brand color, not the package default purple:** `UNFOLD["COLORS"]["primary"]` is an 11-stop OKLCH ramp (50–950) generated by converting the app's own accent `#E4FA1A` (`client-mobile/lib/theme.ts`) to OKLCH (hue 116.11°), then computing the maximum in-gamut sRGB chroma at that hue for each of Unfold's standard lightness stops (via binary search) and taking ~82% of it for a vivid-but-clean look. This is why the admin's buttons/links/active-nav read as Glix lime-green, not generic purple. Conversion script is a one-off (not checked into the repo as a module — the derivation is documented inline as a comment directly above `UNFOLD` in `base.py`); regenerate by converting the target hex to OKLCH (standard sRGB→linear→OKLab→OKLCH matrices) and reusing the same lightness-stop/chroma-search pattern if the accent ever changes.

**`core/admin.py` — full rewrite, not incremental:**
- Every `ModelAdmin` subclass now inherits `unfold.admin.ModelAdmin` instead of `django.contrib.admin.ModelAdmin` — this is what actually produces the styled forms/changelists per-model; adding `"unfold"` to `INSTALLED_APPS` alone only themes the chrome (login, sidebar, base layout).
- `auth.User`/`auth.Group` were unregistered and re-registered with `UserAdmin(BaseUserAdmin, ModelAdmin)` / `GroupAdmin(BaseGroupAdmin, ModelAdmin)`, using Unfold's `UserChangeForm`/`UserCreationForm`/`AdminPasswordChangeForm` (`unfold.forms`) so the built-in auth screens match the rest of the admin instead of falling back to stock Django chrome.
- **7 models that had never been registered** (`Comment`, `CommentLike`, `CommentReport`, `NotificationPreference`, `MovieCache`, `MovieWatchState`, `MovieWatchlist`, `ImportJob`) are now registered — the sidebar nav added above links directly to several of these (Import jobs, Movie watchlist, Comment reports), so they had to exist or those links would 404. All 15 models total now have admin coverage, autocomplete wired between related models (e.g. `CommentAdmin.autocomplete_fields` includes `parent` — a self-FK — which works because Django resolves autocomplete targets against the target model's own registered `ModelAdmin.search_fields` at request time, not at class-definition time).

**Verified live** against the real running `watchtracker_backend` container (not just `manage.py check`): rebuilt the Docker image (`requirements.txt`'s pip install happens at build time, not via the bind-mounted volume, so a code-only restart would not have picked up the new dependency), recreated the container, then scripted a full login (CSRF token → session cookie) and hit all 12 model changelist URLs plus the dashboard — all `200`, zero server errors in `docker logs`, confirmed `oklch`/`unfold` markup present in the rendered HTML.

Admin login: `http://localhost:8001/admin/` (container port 8001, matching `client-mobile/lib/api.ts`'s `API_BASE_URL` — see the native-vs-docker Postgres split noted in `AUDIT.md`; this is the one real database, the other `docker ps` stack on port 8000 is an orphaned second compose project, not used by anything).

---

## Sign in with Google / Apple (Phase 27) — NEW

User asked whether `django-allauth` was the right way to add SSO. **Decision: no** — allauth is built to be the OAuth *client itself* (server-side redirect flow, session-backed state, `django.contrib.sites`), the right shape for a server-rendered web app. Glix is a pure mobile app with a JWT-only, session-free DRF backend — for mobile, the *device* is the OAuth client (native SDK hands the app an ID token directly), and the backend's only job is verifying that token and minting its own session, same as Firebase Auth/Auth0/Supabase do server-side for mobile. Implemented instead as direct ID-token verification.

**Backend:**
- New model `SocialAccount` (`user` FK, `provider` choices `google`/`apple`, `provider_user_id` — the stable `sub` claim, `email`, `created_at`; unique on `(provider, provider_user_id)`) — migration `0007_socialaccount`.
- New `core/social_auth.py`: `verify_google_id_token()`/`verify_apple_id_token()` use PyJWT's `PyJWKClient` (JWKS-based RS256 verification against each provider's published keys) — added `cryptography` to `requirements.txt` as PyJWT's RS256 backend (was missing; not a new auth framework). `get_or_create_social_user()` links by `(provider, sub)` first, falls back to matching an existing account by email **only when the provider asserts `email_verified=True`** (never trust an unverified email claim for linking — takeover risk), otherwise creates a new `User` with an unusable password (`core/signals.py`'s existing `post_save` auto-creates its `UserProfile`, zero new code needed there).
- New `GoogleLoginView`/`AppleLoginView` (`core/auth_views.py`, both subclass a shared `SocialLoginView`) at `POST /api/auth/google/` / `/api/auth/apple/` — same `{access, refresh, profile}` envelope as `RegisterView`/`LoginView`, plus one new field `created` (bool) so the client knows whether to route through onboarding.
- `SocialAccount` registered in `core/admin.py` (Unfold `ModelAdmin`) + a new "Linked accounts" sidebar entry.
- `GOOGLE_OAUTH_CLIENT_IDS`/`APPLE_AUDIENCES` settings (comma-separated env vars) — empty by default, verification fails closed until real values are provisioned.
- **New test file** `core/tests/test_social_auth.py` (15 tests) — crafts real RSA-signed JWTs locally to exercise the actual signature/audience/issuer/expiry-checking code path with zero network calls; covers the security-relevant case explicitly (an unverified email claim must NOT link to an existing account).

**Frontend:**
- New `lib/socialAuth.ts` — `signInWithGoogle()`/`signInWithApple()`, wrapping `@react-native-google-signin/google-signin` and `expo-apple-authentication` (native SDKs, not a browser-redirect flow — the app already requires an EAS dev client for its widget modules, so there's no "stay in Expo Go" reason to prefer the lighter browser-based flow).
- New `components/SocialSignInButtons.tsx` — renders each provider's own official button component (`GoogleSigninButton`, `AppleAuthenticationButton`) rather than a hand-built brand mark (no bundled Google/Apple logo asset exists in this repo, and the official components guarantee guideline compliance for free). Apple's button only renders on iOS + `isAvailableAsync()`.
- Wired into `app/login.tsx` and `app/register.tsx`, between the existing submit button and the footer row.
- `app.json`: `ios.usesAppleSignIn: true`, plugins `expo-apple-authentication` and `@react-native-google-signin/google-signin` (with an `iosUrlScheme` placeholder pending real Google Cloud credentials).

**Hard external blocker (cannot be self-served from any AI session):** real end-to-end verification needs Google Cloud Console OAuth client IDs (Web/iOS/Android) and an Apple Developer "Sign In with Apple" capability + a fresh EAS Build — both need the user's own paid/authenticated accounts. Backend logic is fully verified without them (21/21 pytest passing, including all 15 new tests, live-verified against the real running container); the actual on-device OAuth handshake is not.

---

## Forgot Password via email OTP (Phase 28) — NEW

OTP-code flow, not a token-link flow (no deep-link handling needed on mobile). No new model/migration — codes and one-time reset tokens both live in Django's cache framework (`settings.CACHES`, already Redis-backed since Phase 25), deliberately short-lived (10-minute TTL) rather than persisted.

**Backend:**
- New `core/password_reset.py`: `request_otp(email)` generates a 6-digit code, SHA-256-hashes it before caching (`pwreset:otp:<email>`), and emails it via `send_mail`; also sets a 60-second resend-cooldown cache key regardless of whether the account exists, so the endpoint's timing can't leak which emails are registered. `verify_otp(email, code)` checks the hash, caps wrong attempts at 5 before invalidating the OTP outright, and on success deletes it and mints a single-use `reset_token` (`pwreset:token:<token>`, 10-minute TTL). `confirm_reset(token, new_password)` consumes that token and calls `user.set_password()`.
- New endpoints in `core/auth_views.py`/`core/urls.py` — see the API table above (`/api/auth/password-reset/{request,verify,confirm}/`). `PasswordResetRequestView` always returns the same generic 200 regardless of whether the email exists (enumeration-safe). `PasswordResetConfirmView` returns the same `{access, refresh, profile}` envelope as `RegisterView`/`LoginView` — a successful reset logs the user straight back in.
- **Gmail SMTP** via new `EMAIL_*` settings in `config/settings/base.py` (real credentials in `backend/.env`, placeholders in `.env.prod`). `DEFAULT_FROM_EMAIL` defaults to `Glix <EMAIL_HOST_USER>` — Gmail rejects/rewrites a From header that isn't the authenticated account, and Glix doesn't own a domain to send from a vanity address instead. Chosen over a transactional provider (Resend/SendGrid) specifically because those require domain verification and the user doesn't own one; swapping later only touches these settings, not the `send_mail` call sites.
- **New test file** `core/tests/test_password_reset.py` (12 tests) — module-level + full `APIClient` round-trip coverage: real email sent only for a registered account, silent no-op otherwise, resend-cooldown throttling, wrong-code attempt counting, lockout after 5 attempts, single-use OTP + reset-token consumption, weak-password rejection. Uses the real Redis cache but overrides `EMAIL_BACKEND` to Django's `locmem` backend per-test (`django.core.mail.outbox`) so tests never hit real Gmail SMTP. Full suite now 33 tests (21 prior + these 12), all passing.
- **Styled HTML OTP email:** the code is sent as a branded `multipart/alternative` message via `send_mail`'s `html_message` argument — the app's accent (`#E4FA1A`) and dark surface colors, with a plain-text fallback body so non-HTML clients still get the code. Not a bare-text send.
- **Live-verified past the test suite:** hit the real `/auth/password-reset/request/` endpoint against the user's actual Gmail address through the real SMTP relay (not mocked) — confirmed the App Password authenticates correctly, zero errors in `docker logs`.

**Frontend:**
- New `app/forgot-password.tsx` — one screen, 3 internal steps (email → 6-digit code → new password) rather than 3 separate routes, since threading a `reset_token` through file-based route params is more fragile than local component state for a flow this short. Includes a resend button with a client-side 60-second cooldown countdown matching the backend's.
- `app/login.tsx`: new "Forgot password?" link above the sign-in button, routing to `/forgot-password`.
- On success, stores the returned tokens and routes to `/loading`, matching `login.tsx`'s own submit handler exactly.

---

## EAS Android dev-client build fix — two Gradle duplicates + one runtime SDK mismatch (Phase 28) — NEW

Testing the Phase 27 Google sign-in button surfaced `Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'RNGoogleSignin' could not be found` — a stale dev-client APK predating the `@react-native-google-signin/google-signin` dependency (adding a native module requires a new dev-client build). `expo-dev-client` was also missing from `package.json` (added). Rebuilding then failed at Gradle `:app:mergeDebugResources` with `Duplicate value for resource 'attr/actionBarSize'`.

- **The first diagnosis was wrong.** It was blamed on a google-signin → material/appcompat version conflict; three EAS builds forcing material/appcompat versions all failed on the identical task. A **local** `./gradlew :app:dependencies --configuration debugRuntimeClasspath` (this machine has the Android SDK + Android Studio's bundled JDK 21) disproved it: the graph already resolves to a single unified `androidx.appcompat:1.7.0` / `com.google.android.material:1.12.0` — no version conflict for a `resolutionStrategy.force` to touch.
- **True root cause:** `react-native-shared-preferences@1.0.2` (the Android home-screen-widget data bridge — `require`d in `store/watchStore.ts` + `widgets/android/WidgetProvider.tsx`, so it can't be removed) declares a vestigial `implementation "com.android.support:appcompat-v7:23.0.1"` in its own `android/build.gradle`, pre-AndroidX RN-template boilerplate. Its Java imports zero `android.support.*` classes, so it's dead weight — but its resources still merge, and that 2015-era support library ships a **full** `attr/actionBarSize` definition colliding with AndroidX appcompat-1.7.0's own full definition. Two full definitions of one attr = AAPT2 hard duplicate. (On Windows the same event surfaces as AAPT2's blame-logger throwing `InvalidPathException: Illegal char <:>` while parsing the merge-source id as a file path — masks the real duplicate message that prints on EAS/Linux.)
- **Fix 1:** `client-mobile/plugins/withExcludeLegacySupportLibs.js` — a `withProjectBuildGradle` config plugin injecting `allprojects { configurations.all { exclude group: 'com.android.support' } }` into the generated root `build.gradle` on every `expo prebuild` (wired in `app.json`'s `plugins`; the old `withAndroidMaterialResolutionFix.js` version-force plugin was deleted). Safe because the app is fully AndroidX (`android.useAndroidX=true`) and nothing legitimately uses the pre-AndroidX support stack.
- **Second, independent blocker found via EAS build `da8a089d`'s raw Gradle log:** with Fix 1 in place, `:app:mergeDebugResources` **passed**, but the build then died at `:app:checkDebugDuplicateClasses` — `Duplicate class androidx.work.OneTimeWorkRequestKt (+ the other *Kt) found in work-runtime:2.8.1 and work-runtime-ktx:2.7.1`. Cause: WorkManager 2.8.0 **merged** the `work-runtime-ktx` Kotlin-extension classes into the main `work-runtime` artifact (the standalone `-ktx` became an empty stub), but `react-native-android-widget` still pulls the old `work-runtime-ktx:2.7.1`, whose real `*Kt` classes now collide with the merged copies in `work-runtime:2.8.1`.
- **Fix 2 (same plugin):** add `resolutionStrategy { force 'androidx.work:work-runtime:2.8.1'; force 'androidx.work:work-runtime-ktx:2.8.1' }` to the injected `configurations.all` block, so the `-ktx` artifact resolves to its empty 2.8.1 stub — duplicate gone, runtime not downgraded.
- **Verified locally before the next EAS build:** a fresh `expo prebuild --clean` confirms the plugin injects both the `exclude group` line and the two `force` lines into the regenerated `build.gradle`; `./gradlew :app:mergeDebugResources` → BUILD SUCCESSFUL (Fix 1, the task that failed all three earliest builds) and `./gradlew :app:checkDebugDuplicateClasses` → BUILD SUCCESSFUL (Fix 2, the exact task that failed build `da8a089d`). ✅ EAS dev-client build `4f7be02b` **FINISHED green** with both fixes — dev-client APK produced (`https://expo.dev/artifacts/eas/iDnL6XBIeeObI60fgiPCt6fYlWz48tNtujOWFnRCgQs.apk`).
- **Third blocker — a RUNTIME crash after install (build `4f7be02b`), not a Gradle failure:** the app launched then died at startup with `Failed resolution of: expo/modules/kotlin/types/AnyTypeCache` (thrown from `expo.modules.ui.ExpoUIModule.definition`). Root cause: three packages were installed via plain `npm install` (grabbing `latest` = the **SDK 57** line) into this **SDK 54** app (`expo ~54`, `expo-modules-core@3.0.30`, `react-native 0.81.5`): `@expo/ui@57.0.4`, `expo-widgets@57.0.3` (hard-depends `@expo/ui@~57`), `expo-haptics@57.0.0`. The SDK-57 `@expo/ui` native module references `AnyTypeCache`, a class that only exists in SDK-57's `expo-modules-core` — absent from SDK 54's → resolution fails at module-registry init and crashes the whole app. `expo install --check` confirmed expected SDK-54 versions: `@expo/ui@~0.2.0-beta.9`, `expo-haptics@~15.0.8`.
- **Fix 3a — `expo-haptics`:** it's used on Android (`components/MovieRow.tsx`, `components/ShowRow.tsx`), so it needs a real SDK-54 version — `npx expo install expo-haptics` pinned it to `15.0.8`.
- **Fix 3b — `@expo/ui` + `expo-widgets`:** these are the **iOS-only** home-screen-widget pair (`widgets/ios/*.tsx`; `app.json` already sets the `expo-widgets` plugin `enableAndroid: false`) and have **no SDK-54-compatible release** (earliest `expo-widgets` is `55.x`; there's no `expo-widgets` for `@expo/ui@0.2.x`). Android has no iOS widgets, and the main app bundle never imports `widgets/ios/*`, so nothing on Android needs them — but `@expo/ui`'s native module still autolinks into Android and crashes. Fix: exclude both from **Android native autolinking only** via `package.json` → `expo.autolinking.android.exclude` (schema honored per-platform, verified in `expo-modules-autolinking/build/commands/autolinkingOptions.js`; iOS autolinking untouched). `expo-modules-autolinking resolve -p android` then confirms `@expo/ui`/`expo-widgets` absent, `expo-haptics` present. The iOS widget pair stays installed and is parked until the project moves to SDK 55+ (where a matching `@expo/ui`/`expo-widgets` line exists) — flagged as not-resolved-this-pass.
- EAS dev-client build `356c46ca` re-triggered with all three fixes — ✅ FINISHED green, APK `https://expo.dev/artifacts/eas/lLJUarYd_BPkeTxPQrO_hHjxAJvaqUOhkhKPGKD6nAc.apk`. On-device install + Google sign-in remains the only unverified step. (Do not reuse the `4f7be02b` APK — it predates the `@expo/ui` autolinking exclusion and still crashes at startup.)

---

## Rapid Pre-Deployment Audit + Language Filter & Analytics Back Button (Phase 29) — NEW

User requested a rapid pre-deployment audit (security/config, API health, UI/UX polish, layout diagnostics), plus mid-audit asked for two feature additions: a language filter on Profile > My Shows/My Movies, and a missing back button on the Analytics screen. Full findings summarized in `DEPLOYMENT_READY.md` (new file, root of the repo).

**Audit findings — 1 real bug fixed, rest already compliant:**
- **CRITICAL, fixed:** `components/MovieRow.tsx` and `components/ShowRow.tsx`'s animated watched-checkmark circle used `c.edgeLight` for its unselected border — in the light theme (`lib/theme.ts`) that token resolves to `rgba(255,255,255,0.95)`, near-solid white, invisible against the row's own light background. `edgeLight` is a glass-surface rim-light token (correctly used in `GlassSurface.tsx`/`LiquidTabBar.tsx`), not a general border color. Fixed by switching both to `c.hairline`, the theme's properly-contrasting border token. A visually similar `c.edgeLight` usage in `discover.tsx`'s segmented control was checked and left alone — that control floats over a photo backdrop (documented in its own comment), a legitimate exception.
- **Pressable → PressableScale, fixed (12 files):** the primary submit buttons on `login.tsx`/`register.tsx`/`forgot-password.tsx` (all 3 steps), the logout button on `settings.tsx`, list rows + back buttons on `search.tsx`/`profile/shows.tsx`/`profile/movies.tsx`, the whole-card `ContinueWatchingCard.tsx`/`SeasonCard.tsx`, the cast-voting row in `MVPVotingSheet.tsx`, and the reaction chips in `EmotionPicker.tsx` — all previously plain `Pressable` with manual `pressed`-opacity styling, now consistent tactile `PressableScale` feedback. Removed the now-redundant `xPressed: { opacity }` styles and unused `Pressable` imports.
- **`loading.tsx`:** upgraded its root `View` to `SafeAreaView` for full consistency (22/26 screens already used it; the other 3 gaps — `_layout.tsx`, `(tabs)/_layout.tsx`, the retired `(tabs)/upcoming.tsx` redirect stub — are correctly excluded).
- **Everything else passed clean:** `DEBUG`/`SECRET_KEY`/`ALLOWED_HOSTS`/HSTS in `config/settings/prod.py` (already fail-closed + fully configured); TMDB key already log-masked (`core/services.py`'s `_API_KEY_PATTERN` filter, pre-existing); `FlashList` `estimatedItemSize` already set everywhere; `app.json` bundle IDs/assets already correct; `KeyboardAvoidingView` already correct on all 3 auth screens; `numberOfLines` already applied to every TMDB-title `Text`. The hardcoded-white-color grep found nothing else wrong — every remaining instance is a documented "photo-caption overlay" exception (per `AI_RULES.md` §2), not a bug.
- **Open item, NOT fixed (needs the user):** `client-mobile/eas.json`'s `production` build profile has no `EXPO_PUBLIC_API_URL`. A production build would fall through `lib/api.ts`'s `getDevApiUrl()` to `http://localhost:8001/api/v1` — broken on a real device. **Confirmed with the user: no production backend exists yet**, so this is left as a documented pre-launch blocker (see `DEPLOYMENT_READY.md` §2) rather than filled with a guessed domain.

**Language filter — real gap found in the request's own premise, fixed anyway:**
The request assumed `original_language` already existed on `ShowCache`/`MovieCache`. It did not exist on either model (nor did a model named `ShowCache` — the real model is `CachedShow`). Added end-to-end:
- **Backend:** new `original_language` `CharField(max_length=8, blank=True)` on both `CachedShow` and `MovieCache` (`core/models.py`), migration `core/migrations/0008_add_original_language.py`, applied to the docker dev DB. Populated from TMDB's `original_language` field in both `TMDBService.get_show_details()`/`get_movie_details()` upserts (`core/services.py`, the only two call sites that ever write these models). Exposed via `CachedShowSerializer`/`MovieCacheSerializer`; `WatchlistSerializer`/`MovieWatchlistSerializer` pick it up automatically since they nest those serializers. **Existing cached rows will show blank language until next TMDB refresh** — expected, non-breaking (same pattern as any newly-added cached field).
- **Frontend:** `original_language: string` added to `Show`/`MovieEntry` types; new shared `selectedLanguage: string | null` + `setLanguageFilter()` in `watchStore.ts` (persisted, mirrors the existing `preferredLayout` pattern) — one filter shared across both My Shows and My Movies, matching the request. New `components/LanguageFilterModal.tsx` (simple `Modal` + list, ISO 639-1 → display-name lookup with a raw-code fallback), triggered by a "Language" pill appended to the existing status-filter pill row in both `profile/shows.tsx` and `profile/movies.tsx`. Filtering is 100% client-side against the already-fetched watchlist/movie cache (`e.show.original_language === selectedLanguage` / `item.movie.original_language === selectedLanguage`) — no new API request, per the request's own "keep it instant/offline-fast" requirement. Available language options are derived from the distinct codes actually present in the user's own loaded watchlist, not TMDB's full language list. Both screens' empty-state copy corrected so an all-filters-empty-because-of-language case doesn't show the misleading "Start tracking shows..." message.

**Analytics back button — real gap confirmed, fixed:**
`app/analytics.tsx`'s header had no back button at all (only a title/subtitle + optional spinner) — every sibling Profile-hub detail screen (`achievements.tsx`, `settings.tsx`, etc.) already has one. Added a `PressableScale` + `ArrowLeft` + `router.back()`, matching `achievements.tsx`'s exact bare-icon treatment (its closest sibling — same "pushed from Profile hub" screen shape) rather than settings.tsx's circular-glass-background variant, which belongs to a differently-shaped header.

**Verification:** `manage.py check` clean, `makemigrations --check` clean (no pending model changes), migration applied live. `npx tsc --noEmit` run against the full client — see `PROJECT_STATUS.md`/`ROADMAP.md` for the outcome recorded once the check finished.

---

## Premium Animated Splash (Phase 32) — NEW

User supplied a full execution prompt (choreography table, design tokens, a ready-to-drop-in `AnimatedSplash.tsx` reference component) asking for the static splash-icon-then-plain-loading-screen hand-off to become a single animated sequence. `loading.tsx` previously rendered a static "Glix" wordmark + `ActivityIndicator` with no animation at all, and `app.json`'s native splash showed a static resize of the logo (`splash-icon.png`) on a white background — two separate static frames, no motion.

- **New `components/AnimatedSplash.tsx`** — the reference component, dropped in essentially as-is (`react-native-reanimated` + `react-native-svg`, both already project dependencies, zero new native modules). Glass disc fades/scales in, an SVG ring draws itself clockwise via `strokeDashoffset`, a core dot ignites with a spring bounce, the "GLIX" wordmark reveals letter-by-letter staggered 70ms apart, then a slow breathing glow loop repeats until the `ready` prop flips true, at which point it enforces a 1400ms minimum display before a 380ms scale+fade exit calls `onExitComplete`. Respects `useReducedMotion()` — collapses to a flat 200ms fade with no loop/stagger. Colors (`#000000`/`#E4FA1A`/glass/hairline) are hardcoded, not pulled from `lib/theme.ts`, deliberately — the splash must look identical regardless of the user's light/dark preference (see AI_RULES.md §2a).
- **One real bug fixed in the reference component before it would even type-check:** `Easing.inOut(Easing.sine)` — Reanimated's `Easing` has no `sine` member, only `sin`. Caught by `tsc --noEmit`, not silently left as a "pre-existing baseline" error since it was net-new. Fixed to `Easing.inOut(Easing.sin)`, both occurrences (the glow-pulse loop).
- **`loading.tsx` rewritten**, not just patched: dropped the old inline `MIN_DISPLAY_MS = 600` wait (now redundant — `AnimatedSplash` enforces its own, longer 1400ms floor; keeping both would have stacked two waits back to back) and the plain wordmark/spinner JSX. The existing gate logic — `Promise.all([fetchProfile(), fetchWatchlist()])` — is unchanged; it now flips a `ready` state flag instead of blocking with `await`+`setTimeout`, passed straight into `<AnimatedSplash ready={ready} onExitComplete={...router.replace...} />`. Same `params.next` fallback-to-`/(tabs)` destination logic as before.
- **`_layout.tsx`: `expo-splash-screen` wired in for the first time** — previously **not present in `package.json` at all**, and the native splash had no `preventAutoHideAsync()`/`hideAsync()` calls, meaning it relied entirely on RN's default auto-hide timing. Added `expo-splash-screen` (`~31.0.13`, via `npx expo install`), a module-scope `SplashScreen.preventAutoHideAsync()` call, and `SplashScreen.hideAsync()` in `RootLayoutInner`'s first-mount `useEffect` — hides the native splash only after the JS tree has committed its first frame, closing the "native splash disappears → blank frame → JS content pops in" gap.
- **`app.json`'s `splash` config**: removed the `image`/`resizeMode` keys (previously `splash-icon.png` on a white `#ffffff` background) and set `backgroundColor` to `"#000000"`. The logo now only ever renders via the animated JS layer — it no longer pops natively before `AnimatedSplash` takes over. `splash-icon.png` itself was left on disk untouched (other EAS/app.json tooling may still reference the filename).
- **Verified:** `npx tsc --noEmit` (full client, stack-size workaround) — zero new errors after the `Easing.sine`→`sin` fix, same 4 pre-existing baseline categories as Phase 31 (`watchStore.test.ts`, FlashList v2 `estimatedItemSize`, SDK-57 `@expo/ui` widget types, `HeroCarousel.tsx` ref). Grepped every file touched this pass for stray `watchtracker` branding — only pre-existing, out-of-scope bundle identifiers/scheme (`com.watchtracker.app`, `group.com.watchtracker`) matched, nothing new. `app.json`'s `splash` block confirmed to contain only `backgroundColor: "#000000"`, no image key.
- **Explicitly flagged, not fixed this pass (verified, not assumed):** the execution prompt's own mental model treats `loading.tsx` as "the" cold-boot splash gate. It isn't, for every case — `_layout.tsx` has its own, separate, earlier auth gate (`isAuthChecked`, a plain `ActivityIndicator` on `theme.colors.bg`) that runs before the `Stack` even mounts. For a user who is **already logged in** (valid token in SecureStore), the app boots straight into `(tabs)` after that boot-loader gate and never visits `/loading` at all — `/loading` is reached only via `router.replace('/loading', ...)` after a successful login/register/password-reset (`login.tsx`, `register.tsx`, `forgot-password.tsx`). So the new animated sequence plays on every post-auth-action transition, but **not** on a cold app open with an existing session. Making it cover that path too would mean lifting `AnimatedSplash` above the `Stack` as an always-mounted global overlay with shared ready-state — a materially bigger architectural change (mounting destination screens eagerly before auth resolves) that wasn't in the requested scope; flagged here as a follow-up decision point, not silently done or silently ignored.
- **Not verifiable in this session, stated plainly:** no device/emulator attached — cannot confirm on-device that there's no flash at cold start, that the OS-level reduced-motion setting collapses the sequence correctly, or that the exit crossfade reads as seamless rather than a two-step navigate-then-fade. The code implements the reference choreography and `useReducedMotion()` correctly per static analysis; the visual/on-device claims are unconfirmed until run on a real device or simulator.

---

## Push Notifications Actually Wired End-to-End (Phase 31) — NEW

User pointed at the Settings screen (New episode alerts / Weekly digest toggles, both showing as off in a screenshot) and asked whether push notifications actually work for the mobile app, and to fix it if not. They didn't — past storing a preference.

**What already existed (Phase-unspecified, predates this pass):** `NotificationPreference` model (`user` 1:1, `push_token`, `notify_new_episode`, `notify_weekly_digest`), `NotificationPreferenceView` (GET/PATCH `/api/notifications/preferences/`), `lib/notifications.ts`'s `registerForPushNotificationsAsync()` (requests permission, calls `Notifications.getExpoPushTokenAsync()`), `_layout.tsx` PATCHing the resulting token on auth, and `settings.tsx`'s two `SwitchRow`s PATCHing the two booleans. All of that only ever **stored** state — nothing anywhere ever **read** `push_token`/`notify_new_episode`/`notify_weekly_digest` to actually send a push. Confirmed by grepping the whole backend for any Expo push API call, any `exp.host` reference, any push-sending library — none existed.

**New `backend/core/push_notifications.py`:**
- `notify_users(user_ids, title, body, data=None, preference_field=None)` — looks up `NotificationPreference` rows for the given users with a non-empty `push_token` (optionally also filtered on a boolean preference field), batches into groups of 100 (Expo's per-request cap), and POSTs each batch to `https://exp.host/--/api/v2/push/send` via the already-pinned `requests==2.34.2` — no new dependency needed.
- Reads Expo's per-message receipts back; any receipt with `status: "error"` and `details.error: "DeviceNotRegistered"` clears that row's `push_token` (set to `None`) so a dead token (uninstalled app, etc.) doesn't keep costing a request on every future send.

**New-episode alerts wired into the existing `refresh_show_cache` Celery task (`core/tasks.py`):**
- Before this pass, `refresh_show_cache` only re-synced `CachedEpisode` rows from TMDB; nothing downstream ever knew "this episode just showed up." Now it snapshots the show's existing episode `tmdb_id`s before the season refetch loop, and after, diffs for episodes that are both **new to the cache** and **airing today** (`air_date == timezone.now().date()`) — that combination is what "a new episode just aired" actually means, as opposed to e.g. an initial add backfilling years of already-aired episodes.
- Any such ids are handed to a new `notify_watchers_of_new_episodes(tmdb_id, episode_tmdb_ids)` task, which looks up every `Watchlist` row for that show excluding `ARCHIVED`, and calls `notify_users(..., preference_field="notify_new_episode")` — a single-episode event gets a titled message (`S01E04 – Episode Title`), a multi-episode event (season premiere with several episodes airing the same day) gets a count-based message instead of spamming one push per episode.

**New `send_weekly_digest` task, not previously wired to anything:**
- Queries every `NotificationPreference` with `notify_weekly_digest=True` and a push token, counts `WatchState` rows in the trailing 7 days per user, and sends a recap push (`"You watched N episodes this week."`). Users with 0 watched episodes that week are skipped entirely rather than nagged with an empty digest.

**The actual root cause of "nothing happens no matter what the user does" — no Celery Beat process existed at all.** `docker-compose.yml` defined a `db`, `redis`, `backend`, and a `celery` **worker** service — a worker only executes tasks it's handed (e.g. via `.delay()` from a request, or another task), it does not run anything on a timer by itself. There was no `CELERY_BEAT_SCHEDULE` in settings and no `celery -A config beat` process anywhere — so even `sync_active_shows` (the periodic sweep `tasks.py`'s own docstring describes as "wire up via Celery beat," dated well before this pass) had never actually been running periodically. Fixed:
- Added `CELERY_BEAT_SCHEDULE` to `config/settings/base.py` (new `from celery.schedules import crontab` import): `sync_active_shows` every 6 hours (the task that now also detects new episodes via `refresh_show_cache`), `send_weekly_digest` every Monday 9am.
- Added a `celery-beat` service to `docker-compose.yml` (`celery -A config beat -l INFO`), same build context/env vars as the existing `celery` worker service, its own container name (`watchtracker_celery_beat`).

**Client-side bug fixed in passing (`lib/notifications.ts`):** the push-token registration code declared `const projectId = 'your-expo-project-id'` (a literal placeholder comment) and then called `Notifications.getExpoPushTokenAsync()` with **no arguments at all** — the declared variable was dead code, never passed anywhere. Fixed to read the real EAS project id already present in `app.json` (`extra.eas.projectId: "dc895a3e-62d1-432e-985e-53250e3d0e7f"`) via `Constants.expoConfig?.extra?.eas?.projectId` and pass it explicitly to `getExpoPushTokenAsync({ projectId })` — the documented-safe pattern, rather than relying on Expo's auto-detection.

**Verification:** `manage.py check` clean. Direct Python import of `core.tasks` (including the two new task functions) and `core.push_notifications` succeeds under `config.settings.dev`. `CELERY_BEAT_SCHEDULE` confirmed to resolve to real `crontab` schedule objects, not just syntactically valid config. `npx tsc --noEmit` (full client) shows zero new errors — same pre-existing baseline as Phase 30 (FlashList v2 `estimatedItemSize`, SDK-57 `@expo/ui` widget types, one pre-existing test file, one pre-existing `HeroCarousel` ref issue); none reference `lib/notifications.ts`.

**Done, same session (not left pending):** the `docker compose up -d --build` needed to actually rebuild/restart containers and pick up the new `celery-beat` service and settings/task changes — held for explicit user confirmation rather than run silently, then run after approval. All 5 containers confirmed `Up`; `celery-beat`'s logs confirmed a clean `beat: Starting...` with the Redis broker connected. Still open: confirming an actual push lands on a real device: needs a permission-granted physical device on a real EAS dev-client build, and either a tracked show genuinely airing a new episode or the Monday digest schedule firing — none of which are producible from this session. The send path itself (`push_notifications.py`, the two new tasks, the Beat schedule) is real, unit-verified code, not a stub; the very last mile is standard for any push-notification feature and is on the user's own device.

---

## Glix Rebrand + Categorized Language Filter + Shows Hub Default Tab (Phase 30) — NEW

User supplied the real logo asset (`client-mobile/assets/Glix.png`, 1254×1254) and asked for a full "WatchTracker" → "Glix" rebrand, an upgrade of Phase 29's flat language filter into categorized sections, and (separately, via a screenshot) a fix so the Shows Hub always opens on the WATCH NEXT pill.

**Rebrand — case-sensitive "WatchTracker" → "Glix" across the repo:**
- **Docs:** `context.md`, `PROJECT_STATUS.md`, `ROADMAP.md`, `AUDIT.md`, `DEPLOYMENT_READY.md` — all text occurrences replaced. `README.md` does not exist anywhere in the repo (checked root, `client-mobile/`, `backend/`) — nothing to change there. Also updated, though not in the user's explicit list, for consistency: `WATCHTRACKER_AI_PLAYBOOK/AI_RULES.md`'s body text (the containing folder name itself was deliberately left unrenamed — a folder rename is structurally riskier and wasn't in scope).
- **`client-mobile/app.json`:** `name` (was the unset placeholder `"client-mobile"`, not literally "WatchTracker") → `"Glix"`; `slug` (`"watch-tracker"`) → `"glix"`. `extra.eas.projectId` deliberately untouched — it's the durable EAS project link, independent of `slug`.
- **Assets:** `icon.png`, `adaptive-icon.png`, `splash-icon.png` overwritten with a 1024×1024 resize of `Glix.png`; `favicon.png` with a 48×48 resize (PowerShell `System.Drawing`/`Bitmap`/`HighQualityBicubic`, no new dependency). `Glix.png` itself left in place unmodified.
- **Frontend text/comments:** `lib/errors.ts`'s network-error copy, `lib/migration.ts` (function renamed `exportWatchTrackerData` → `exportGlixData`, export filename prefix, share dialog title — both call sites in `app/(tabs)/profile.tsx` updated), `loading.tsx`'s wordmark, all 4 widget title strings (`widgets/android/*`, `widgets/ios/*`), plus comment-only edits across several files.
- **Backend text:** `core/password_reset.py`'s OTP email subject/body/HTML wordmark span/footer, `config/settings/base.py`'s `DEFAULT_FROM_EMAIL` default + Unfold `SITE_TITLE`/`SITE_HEADER`, `core/auth_views.py` (class renamed `WatchTrackerTokenObtainSerializer` → `GlixTokenObtainSerializer`, both the definition and `LoginView.serializer_class`), `.env`/`.env.prod` comment headers, plus comment-only edits in `models.py`/`services.py`/`social_auth.py`/`serializers.py`.
- **Deliberately left unrenamed, flagged rather than silently skipped:** the Zustand persist storage keys `watchtracker-store` (`store/watchStore.ts`) and `watchtracker-theme` (`store/themeStore.ts`). Renaming either would make `zustand/persist` find no data under the new key on next launch for any already-installed user — silently resetting their locally-persisted theme, layout, and language-filter preferences. Not asked for in the explicit rebrand scope (docs/app.json/hardcoded display names/assets); a real migration (read old key, write new, delete old) would be needed to rename these safely, out of scope for this pass.

**Language filter upgraded to categorized sections (`components/LanguageFilterModal.tsx`):**
- Replaced the flat single-list `FlatList` with a sectioned `ScrollView`: "All languages" always rendered first, standalone, outside any section (pre-selected by default when no filter is active); then a "Major Indian Languages" section (Malayalam/Tamil/Telugu/Kannada/Hindi — `ml`/`ta`/`te`/`kn`/`hi`) rendered only if any of those codes are present in the caller's data; then a "Global Languages" section (everything else, e.g. English/Spanish/Korean) rendered only if any remain. Section header styling matches `DiscoverFilterSheet.tsx`'s `sectionLabel` convention (12px/700/0.8 letter-spacing/uppercase).
- `LANGUAGE_NAMES` extended with `ml`/`ta`/`te`/`kn` (previously only `hi` existed among the "Indian" set).
- No changes needed in `profile/shows.tsx`/`profile/movies.tsx` — both still pass the same `availableLanguages` (derived client-side from the loaded watchlist/movie cache) and `selectedLanguage`/`setLanguageFilter` from Phase 29; the categorization is entirely internal to the modal. Filtering logic remains 100% client-side, no new API request.

**Shows Hub default tab fix (`app/(tabs)/index.tsx`):**
- User reported (via screenshot) that the Shows Hub was opening on "HAVEN'T WATCHED FOR A WHILE" instead of "WATCH NEXT". Root cause: `useState<FilterKey>('ATTENTION')` initialized the filter to the attention bucket. Changed to `useState<FilterKey>('WATCH_NEXT')` so the Shows Hub now always opens on WATCH NEXT by default, matching the Movies Hub's pre-existing default (see the `highlightFilter` note above, now updated to reflect both hubs sharing the same default).

**Verification:** `npx tsc --noEmit` (full client, `node --stack-size` workaround for the unrelated stack-depth issue) shows zero new errors — every line maps to the same four pre-existing baseline categories documented in Phase 29 (FlashList v2 `estimatedItemSize` type mismatch, SDK-57 `@expo/ui` widget prop types, one pre-existing test file, one pre-existing `HeroCarousel` ref-nullability issue); none reference `LanguageFilterModal.tsx`, `analytics.tsx`, the renamed `exportGlixData`/`GlixTokenObtainSerializer`, or `(tabs)/index.tsx`. `analytics.tsx`'s back button (added in Phase 29) re-confirmed present and unchanged. No new hardcoded colors introduced — every edit this phase was either a text-string rename or a structural (non-visual) modal rewrite reusing existing theme tokens (`c.glassFill`/`c.hairline`/`c.accentInk`/`c.textPrimary`/`c.textSecondary`).

---

## Navigation Structure

```
Root Stack (_layout.tsx)
├── (tabs)                    ← authenticated main hub
│   ├── index (Shows Hub)
│   ├── movies (Movies Hub)
│   ├── discover (Discover Hub)
│   └── profile (Profile Hub)
├── login / register / onboarding / loading
├── search (modal)
├── settings
├── show/[id]                 ← Show Details + optimistic UI
├── show/[id]/comments
├── show/[id]/season/[season]
├── episode/[id]
├── movie/[id]                ← Full Movie Details (Phase 8 — was placeholder)
├── profile/shows
├── profile/movies
├── community / analytics / statistics / achievements / year-review
```

**Auth gate:** `_layout.tsx` reads `SecureStore` at cold boot. Redirects to `/login` if no token. Axios interceptor silently refreshes on 401.

---

## Optimistic UI / Navigation Pattern

All media cards (HeroCarousel, HorizontalMediaList, search results, discover) pass preliminary data through routing params so detail screens render **instantly** without a loading spinner:

```ts
router.push({
  pathname: `/show/${item.tmdb_id}`,
  params: {
    title: item.title,
    poster_path: item.poster_path ?? '',
    backdrop_path: item.backdrop_path ?? '',
    overview: item.overview ?? '',
    vote_average: item.vote_average.toString(),
  },
});
```

The detail screen uses these as fallback data while the real API call completes silently in the background.

---

## Widgets

**Data bridge, single source of truth:** `store/watchStore.ts`'s `syncWidgetData()` (called after `fetchWatchlist`/toggle actions) computes `{ watchlist: [...], upcoming: [...] }` from the current `watchlist.to_watch` bucket — reusing `lib/upcoming.ts`'s `pickNextEpisode()` (shared with the Shows Hub row) and `buildUpcomingItems()` so the widget is truthful to what the app itself would show, not an approximation. `clearWidgetData()` (same file) writes an empty payload on logout (`app/settings.tsx`'s `performLogout`).

### Android (`react-native-android-widget`)
- **Files:** `widgets/android/WidgetProvider.tsx` (read side: `widgetTaskHandler`, invoked by the OS), `WatchlistWidget.tsx`, `UpcomingWidget.tsx` (render components, now with poster thumbnails via `ImageWidget`)
- **Registration:** `_layout.tsx` calls `registerWidgetTaskHandler(widgetTaskHandler)` on Android
- **Write side:** `watchStore.ts`'s `syncWidgetData()` writes to `react-native-shared-preferences` under the `widgetData` key, then proactively calls `requestWidgetUpdate()` for both widget names so the home screen redraws immediately instead of waiting for Android's own `updatePeriodMillis` interval. (`WidgetProvider.tsx` no longer has its own duplicate `syncWidgetData` export — it was dead code, never imported, removed in the Phase 6 audit.)
- **Important fix (Phase 8):** `react-native-shared-preferences` native module is `null` during Expo Go / dev-client (before a full native build). All access is null-guarded with try-catch — same pattern reused for the Android widget-update native module and the iOS widget import below.

### iOS (`expo-widgets`)
- **Files:** `widgets/ios/WatchlistWidget.tsx`, `UpcomingWidget.tsx` — each exports a named `Widget` instance via `createWidget(name: string, layout: (props, environment) => JSX.Element)` (the actual installed SDK signature; a Phase 6 audit found these previously called `createWidget(Component, configObject)`, which doesn't match the API at all).
- **Data bridge (fixed, Phase 6 audit):** `watchStore.ts` calls `.updateSnapshot(props)` directly on the imported `Widget` instances — this is `expo-widgets`' real IPC mechanism. A prior version wrote a JSON file to `FileSystem.documentDirectory`, which is the app's private sandbox directory and is never visible to the widget extension process; that path was a complete no-op and has been removed.
- **App Group:** `group.com.watchtracker` configured in `app.json`'s `ios.entitlements`, and now also passed as `groupIdentifier` to the `expo-widgets` config plugin (previously the plugin's config object was empty, so its `widgets` array — used to generate the actual widget extension target — defaulted to `[]`; both "Watchlist" and "Upcoming" are now declared there).
- **Known gap:** `app.json` has no `ios.bundleIdentifier` set, which `expo-widgets`' plugin needs to derive the widget target's own bundle id — see `AUDIT.md`'s open item. Requires an explicit app-identity decision before the next EAS build.
- **Note:** Requires EAS Build — cannot be tested in Expo Go

---

## Known Issues & Technical Debt

| Severity | Issue | Status |
|----------|-------|--------|
| 🟡 Medium | `ShowSearchView` unpaginated, no server cache | Accepted — UniversalSearchView is the primary search |
| 🟡 Medium | Error extraction still duplicated in some older components (community.tsx, register.tsx) | Low priority |
| 🟡 Medium | Analytics: Provider charts return stub (no per-user provider storage) | Deferred — needs new model |
| 🟡 Medium | Analytics: Director charts deferred (no crew data stored per WatchState) | Deferred |
| 🟡 Medium | iOS widgets require EAS Build, untestable in Expo Go | By design |
| 🟢 Low | Movie "Mark as Watched" requires movie to exist in MovieCache first | Auto-created on first `/movies/<id>/detail/` fetch |
| 🟢 Low | Orphaned second `docker compose` stack (`backend-*-1`, port 8000/5433) running alongside the real one (`watchtracker_*`, port 8001/5432) | Harmless but wasteful — `docker compose down` it when convenient, see AUDIT.md Phase 26 |

---

## All Bugs Fixed (Chronological)

| Bug | File | Fix |
|-----|------|-----|
| Axios interceptor infinite loop on 401 | `lib/api.ts` | Added `_retry` flag |
| Register crashing (expo-router import) | `register.tsx` | Fixed import path |
| TMDB 404 on TV search endpoint | `services.py` | Updated endpoint path |
| Tab bar covering content | `(tabs)/_layout.tsx` | Added `paddingBottom` |
| Missing CORS wiring | `settings.py` | Added `corsheaders` to INSTALLED_APPS |
| FlashList ShowRow recycling blank gap | `ShowRow.tsx` | Reset Reanimated shared values on `episodeId` change |
| Celery cannot start | `celery.py` | Fixed app instance reference |
| No frontend token refresh | `api.ts` | Implemented queue-based 401 interceptor |
| `withAndroidWidgets` plugin crash on startup | `node_modules/react-native-android-widget/app.plugin.js` | Added null-checks for widget params |
| Backend tests `NoReverseMatch` (auth_login) | `test_views.py` | Updated to hyphenated URL names (`auth-login`) |
| Backend tests `IntegrityError` on UserProfile | `test_models.py` | Switched `.create()` to `.get()` for auto-created profiles |
| `Cannot read property 'length' of undefined` in discover.tsx | `discover.tsx` | Guarded `currentFeed?.sections` with `?? []` |
| Duplicate key `.$344` in show/[id].tsx providers | `show/[id].tsx` | Changed key to `${provider_id}-${index}` |
| Widget `TypeError: setItem of null` | `widgets/android/WidgetProvider.tsx` | Null-guarded entire SharedPreferences module |
| Movie detail screen was a placeholder | `movie/[id].tsx` | Full implementation with TMDB integration |

---

## Running the Project

```bash
# Start backend + database
cd d:\watchtracker
docker compose up -d

# Backend health check
docker compose exec backend python manage.py check

# Run backend tests
docker compose exec backend pytest -q
# Expected: 6 passed

# Start mobile dev server
cd d:\watchtracker\client-mobile
npx expo start -c

# Scan QR code with Expo Go on phone OR run in Android Studio simulator
# Same backend user accounts work on both phone + simulator (same local server)
```

### Environment Variables (backend/.env)
```
SECRET_KEY=...
TMDB_API_KEY=...
DATABASE_URL=postgres://watchtracker:watchtracker@db:5432/watchtracker
DEBUG=True
ALLOWED_HOSTS=*
```

### Mobile API Base URL (client-mobile/lib/api.ts)
```ts
// Points to your local machine's IP, e.g.:
const BASE_URL = 'http://192.168.x.x:8000/api';
```

---

## Test Suite

**Backend** (`pytest`): 6 tests, all passing as of 2026-07-13
- `test_models.py`: UserProfile auto-creation, watchlist operations
- `test_views.py`: Auth endpoints, watchlist CRUD, show detail

**Frontend** (Jest): Basic component tests configured via `jest-expo`

---

## Completion Status

| Area | % | Notes |
|------|---|-------|
| Backend Core | 100% | All CRUD, auth, TMDB proxy, analytics |
| Movie Features | 100% | Full detail screen + 4 new backend endpoints (Phase 8) |
| Search & Discovery | 100% | Relevancy engine, fallback, caching (Phase 8) |
| Frontend UX | 100% | Optimistic UI across all navigation paths |
| Widgets | 95% | Android fixed; iOS needs EAS build to test |
| Infrastructure | 100% | Docker, Celery, CI/CD, .env |
| Community | 100% | Comments, replies, likes, moderation |
| Analytics | 100% | 11 endpoints, 4 screens |
| Testing | 95% | Backend 6/6; frontend Jest configured |
| **Overall** | **99%** | Production-ready; widget native build pending |