# Glix Project Context

## 2026-10-10 — Watch Next, widgets, release filters and yearly recap

- Removed watched-finale fallbacks; successful catch-up of uncached predecessors reconciles authoritative watchlist/history. Android widget snapshots now support the native CommonJS module, use a small independent durable cache, paint before network work and survive unresolved hydration. Root lifecycle auth guards update after login/logout.
- Compact top tabs retain 48dp targets, access filters use one picker, and the calculator has provider spacing. New releases combines with platform/genre/country/access. Release rails merge two TMDB pages with exact cached TVmaze evidence, query-specific backups and an optional region-limited Watchmode supplement.
- Analytics separates series/movie time, includes movie repeat time, refreshes movie activity, adds backlog/pace insights, and guards partial season coverage. Year in Review now includes both media types, repeats, timezone-correct yearly streaks, monthly chapters, ratings, a full virtualized yearly library and a branded share card.
- Fixed cold-token rotation/logout races and deferred OTA timer cleanup. Removed an orphaned chart, an unused tab type and unused Python imports; strengthened the ineffective TMDB proxy test. No migration, package update or separate deployment. Research, root causes, source limits and verification are in [REFINEMENTS_2026-10-10.md](REFINEMENTS_2026-10-10.md). Native launcher/hardware checks remain necessary.


## 2026-10-03 — Watch flow, discovery, and profile refinements

- Watched cached episodes now suppress stale TMDB upcoming summaries. Computed watchlist statuses match their buckets; duplicate taps, stale fetches, and failed concurrent updates are reconciled. History totals update even when the affected episode is outside the loaded page. Queued release notifications exclude users who already watched every announced episode.
- Watch Next advances in the same show row and retains queue order. Navigation uses a 200 ms UI-thread indicator. Countdown and hero timers pause offscreen/background; hero autoplay has a pause control and respects reduced motion, rotation, and larger text.
- Discover supports combined media type, genre, platform, country, language, sort, and streaming/rental/purchase access. Filters apply together, provider pickers are searchable, and detail pages show the same region with explicit access labels. Movie rails use recent regional digital release dates; TV rails describe recent episodes, not dates when a title joined an OTT catalogue.
- Added a series watch calculator with known/estimated runtimes, remaining/whole-series modes, daily time budgets, weekdays, and completion-date estimates. Future release dates can extend the estimate.
- Added Classics cast portraits from highly rated films and series, 24 new illustrated avatars, searchable character/title labels, selection previews, and explicit confirmation. TMDB portraits remain credited actors' headshots. Shared controls gained larger touch targets; notification writes restore the prior setting on failure.
- Removed compiler-proven unused declarations and enabled TypeScript unused-local/parameter checks. Existing user/episode and user/watch-time indexes cover the changed queries; no schema migration, app dependency, or production deployment was added.
- Verification: client strict typecheck, Jest 88/88 (14 suites), and Expo production web export pass. Backend full suite passed 259/259 before the final recommendation/release-label changes; the final changed-path run passed 52/52, and the current suite collects 261 tests. Django checks pass with no pending migrations. Browser automation could not initialize (missing runtime assets). Native smoothness, visual appearance, and haptics still require device verification; peak performance has not been benchmarked on hardware.


**Last verified:** 2026-10-03

Glix is a premium TV and movie tracking app built as a Django/DRF backend and an Expo React Native mobile client. This file describes what currently exists. For visual rules and the complete screen-by-screen product guide, see [DESIGN.md](DESIGN.md). Historical implementation details remain in [PROJECT_STATUS.md](PROJECT_STATUS.md) and [AUDIT.md](AUDIT.md).

## Current Stack

| Area | Current implementation |
|---|---|
| Mobile | Expo SDK 54, React 19, React Native 0.81, TypeScript |
| Navigation | Expo Router 6, file-based routes under `client-mobile/app/` |
| State | Six Zustand stores, split by domain |
| UI | React Native, FlashList 2, Reanimated, expo-image, glass/theme primitives |
| Backend | Django 6, Django REST Framework, SimpleJWT |
| Data | PostgreSQL, Redis, Celery/Celery Beat |
| External media | TMDB v3 through `TMDBService`; TVmaze for air-time enrichment |
| Auth storage | JWT tokens in Expo SecureStore; app state in AsyncStorage where appropriate |
| Admin | django-unfold |
| Hosting shape | Dockerized backend; Render deployment supports gunicorn, Celery worker, and Celery Beat in the current single-service setup |

## Repository Map

```text
watchtracker/
├── CONTEXT.md                 current architecture and product reference
├── DESIGN.md                  visual system, UX, screens, and feature guide
├── ROADMAP.md                 phase checklist and remaining work
├── PROJECT_STATUS.md          detailed implementation history and verification
├── AUDIT.md                   audit findings, fixes, and verification records
├── DEPLOYMENT_READY.md        deployment checklist and production blockers
├── backend/
│   ├── config/                Django settings, URL root, WSGI/ASGI, Celery
│   └── core/                  models, serializers, views, services, tasks, tests
├── client-mobile/
│   ├── app/                   Expo Router screens and layouts
│   ├── components/            shared visual and domain components
│   ├── lib/                   API, theme, dates, persistence, notifications, widgets
│   ├── store/                 six Zustand stores
│   ├── widgets/               Android and iOS home-screen widgets
│   └── __tests__/              client unit and store tests
└── WATCHTRACKER_AI_PLAYBOOK/  agent operating rules
```

## Mobile Screens

There are 32 `.tsx` route files under `client-mobile/app/`, including two layout files. There are 30 route files excluding layouts and 29 active user-facing route surfaces because `(tabs)/upcoming.tsx` is a retired redirect stub kept for compatibility.

### Layouts

- `app/_layout.tsx`: root providers, auth boot, splash, error boundary, notifications, modals, and Stack registration.
- `app/(tabs)/_layout.tsx`: bottom tab navigation and liquid tab bar.

### Entry and account

- `login.tsx`: email/password, Google, Apple, forgot-password entry.
- `register.tsx`: account creation and social sign-up.
- `forgot-password.tsx`: email OTP request, verify, and password reset.
- `loading.tsx`: authenticated bootstrap, backend warm-up, prefetch, animated splash hand-off.
- `onboarding.tsx`: first-use quick-add flow.

### Main tabs

- `(tabs)/index.tsx`: Shows Hub with Watch List, Upcoming, Watch History, list/grid/calendar layouts, catch-up, anime split, and completion feedback.
- `(tabs)/movies.tsx`: Movies Hub with Watch Next, Watched, Last Watched, filters, and list/grid layouts.
- `(tabs)/discover.tsx`: Discover Hub with hero carousel, Series/Movies feeds, filters, search, pagination, and For You.
- `(tabs)/profile.tsx`: Profile Hub with profile, watch-time, social, media, reviews, lists, and settings links.
- `(tabs)/upcoming.tsx`: retired redirect route; not an independent active screen.

### Media routes

- `search.tsx`: universal show/movie search and add/open actions.
- `show/[id].tsx`: show detail, watchlist, favorite, trailer, provider, review, comment, list, and rewatch actions.
- `show/[id]/season/[season].tsx`: season episodes, progress, bulk actions, catch-up, and rewatch mode.
- `show/[id]/comments.tsx`: show comments, replies, likes, and reports.
- `episode/[id].tsx`: episode detail, credits, interaction, and watch action.
- `movie/[id].tsx`: movie detail, watch state, trailer, provider, review, list, and rewatch actions.

### Profile, social, and analytics routes

- `profile/shows.tsx`, `profile/movies.tsx`, `profile/anime.tsx`: personal media surfaces with filters and layout controls.
- `profile/reviews.tsx`: personal reviews.
- `community.tsx`: Discussions, review activity, and People.
- `user/[username].tsx`: public profile.
- `user/[username]/connections.tsx`: followers/following.
- `analytics.tsx`: TV/Movie analytics dashboard.
- `statistics.tsx`: detailed statistics.
- `achievements.tsx`: badge progress.
- `year-review.tsx`: yearly recap and share image.
- `settings.tsx`: theme, default layout, profile editing, notifications, data, logout.

### Lists

- `lists/index.tsx`: user-created list hub.
- `lists/[id].tsx`: list detail and item management.

The full navigation and feature explanation is in [DESIGN.md](DESIGN.md#navigation-map).

## Client Architecture

### Zustand stores

The client no longer has one global store. It has six domain stores:

| Store | Responsibility |
|---|---|
| `store/watchStore.ts` | Show/movie watchlists, episodes, history, profile, analytics fetches, catch-up, completion, import state |
| `store/discoverStore.ts` | Discover feeds, genres, filters, search results, pagination, For You |
| `store/listsStore.ts` | Custom list CRUD, detail, membership |
| `store/socialStore.ts` | Community, follows, profiles, connections, activity |
| `store/preferencesStore.ts` | Default layout and per-screen overrides |
| `store/themeStore.ts` | System/Light/Dark preference |

### Shared client modules

- `lib/api.ts`: shared Axios instance, JWT attachment, refresh/retry behavior, transient failure handling.
- `lib/theme.ts`: adaptive color tokens and theme resolution.
- `lib/dateFormat.ts`: aired dates, air instants, time zones, release labels, local air-time formatting.
- `lib/upcoming.ts`: Upcoming selection, overdue recency bounds, grouping, and next-episode logic.
- `lib/persistStorage.ts`: debounced, hydration-aware AsyncStorage adapter.
- `lib/warmup.ts`: backend health probe and cold-start messaging.
- `lib/notifications.ts`: Expo push registration and foreground behavior.
- `lib/widgetPayload.ts`: shared widget payload construction.
- `lib/migration.ts`: TV Time import/export helpers and progress polling.
- `lib/anime.ts`: Anime and Animation classification helpers.
- `lib/useCatchupCascade.ts`: catch-up check and modal orchestration.
- `lib/motion.ts`: shared motion constants and reduced-motion handling.

### Shared UI

The component library includes poster/row cards, FlashList rails, glass surfaces, blur layers, tabs/segments, filter sheets, list sheets, rating/review cards, charts, progress rings, error states, snackbars, avatar tools, animations, completion/badge feedback, and widget renderers. Reuse existing components before creating a new variant.

## Backend Architecture

### URL modules

`backend/core/urls.py` owns health, auth, tracking, profile, movie, import, discovery, search, and TMDB proxy routes. It includes these feature modules:

- `comment_urls.py`: comments, replies, likes, reports, moderation.
- `review_urls.py`: show/movie reviews.
- `analytics_urls.py`: dashboard, statistics, genres, MVP characters, providers, completion, movies, heatmap, streak, year review, monthly summary, achievements.
- `lists_urls.py`: custom lists and membership.
- `recommendations_urls.py`: personalized For You.
- `social_urls.py`: people, follows, profiles, connections, activity.
- `rewatch_urls.py`: show rounds, episode rewatch state, movie rewatch events.

All API routes are mounted under `/api/v1/` by `backend/config/urls.py`.

### Database models

`backend/core/models.py` currently defines 24 models:

**Identity:** `UserProfile`, `SocialAccount`.

**Cached media:** `CachedShow`, `CachedEpisode`, `MovieCache`.

**First-watch tracking:** `Watchlist`, `WatchState`, `MovieWatchlist`, `MovieWatchState`.

**Community/social:** `Follow`, `Comment`, `CommentLike`, `CommentReport`, `EpisodeInteraction`.

**Profile and notifications:** `WatchStreak`, `NotificationPreference`.

**Rewatch:** `ShowRewatch`, `RewatchEpisodeState`, `MovieRewatch`.

**Lists/reviews/import:** `CustomList`, `CustomListItem`, `ShowReview`, `MovieReview`, `ImportJob`.

### Service and task boundaries

- `core/services.py` is the only TMDB client. It owns caching, retries, timeouts, external-id lookup, detail data, credits, providers, videos, and recommendations.
- `core/airtime.py` enriches shows and episodes with TVmaze schedule/airstamp data.
- `core/views.py` owns core watchlist, watch state, discovery, movie, health, and import status flows.
- `core/search_views.py` owns search and media detail proxy flows.
- `core/tasks.py` owns Celery imports, cache refresh, air-time sync, stalled-import recovery, badges, streaks, and notifications.
- `core/signals.py` creates profiles and invalidates caches or recalculates dependent state after writes.
- `core/push_notifications.py` sends Expo push messages and removes dead tokens.
- `core/admin.py` exposes the admin tools and profile/watch-time recovery actions.

## Feature Summary

- JWT auth, email/password, Google, Apple, OTP password reset.
- Shows, episodes, movies, watchlists, favorites, archive state, undo, catch-up, bulk marking, history, calendar grouping.
- Unreleased-content gates enforced server-side.
- Anime/My Anime split and Animation filter.
- Exact or best-available local release time from TVmaze and fallback sources.
- Discover feed, search, genre/language filters, infinite pagination, For You, detail recommendations, providers, trailers.
- Private half-star reviews and notes, watched-to-review gate, comments, replies, likes, reports.
- Follow graph, private profiles, public profiles, connections, people search, review activity feed.
- User-created cross-media lists.
- Show rewatch rounds and movie rewatch events.
- TV and movie analytics, full-history heatmap, streaks, achievements, Year in Review, share image.
- TV Time import with Celery chunking, resume, progress, idempotency, and stalled-job recovery.
- Android/iOS Upcoming widgets with offline snapshots and logout privacy state.
- Push notifications for new episodes and weekly digest.
- Adaptive light/dark theme, glass UI, animated splash, reduced-motion support, error boundary, accessibility labels on audited controls.

## Data Flow

1. Expo Router loads a screen.
2. The screen reads one or more domain stores and the resolved theme.
3. Requests go through `lib/api.ts`; no screen creates a separate Axios client.
4. The API attaches JWT credentials and refreshes only when the server reports an expired token.
5. Store actions use optimistic updates where useful, preserve rollback snapshots, and reconcile server responses.
6. Django scopes user data to the authenticated user and serializes the client contract.
7. TMDB data is fetched only through `TMDBService`, cached locally, and persisted in PostgreSQL.
8. Celery handles slow or scheduled work so imports, air-time enrichment, notifications, and cache refresh do not block normal requests.
9. Cache invalidation uses signals for normal writes and explicit invalidation for bulk operations that bypass save signals.

## Current Verification and Blockers

As of 2026-10-03, client Jest passes 88/88 across 14 suites, strict `npm run typecheck` passes with unused-local/parameter checks enabled, and the Expo production web export succeeds. The backend full suite passed 259/259 before the final recommendation/release-label changes, followed by 52/52 passing changed-path tests; the current suite collects 261 tests. Django system checks pass and no model migrations are pending. Use `npm run typecheck` in `client-mobile/`; bare `npx tsc --noEmit` can hit the known Windows V8 stack-size crash.

Device/deployment checks still require real environments: native widget appearance, real push delivery, production OAuth configuration, complete light/dark visual review, and Render cold-start timing after deployment.

Before a production EAS build, replace the `EXPO_PUBLIC_API_URL` placeholder in `client-mobile/eas.json` with the real deployed API URL. Do not ship the localhost fallback.

## Documentation Rules

When code changes, update this file, `ROADMAP.md`, `PROJECT_STATUS.md`, and `AUDIT.md` with a concise current-state entry. Historical phase entries should remain intact, but current facts belong near the top of the relevant document. When docs conflict with source, source wins and the docs should be corrected.
