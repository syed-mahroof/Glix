# Glix Design and Product Guide

**Last verified:** 2026-09-24

This document describes the current Glix mobile product: its visual language, navigation, screens, interaction rules, data flow, and design constraints. Source code remains authoritative when this document and the app differ.

## Product

Glix is a premium TV and movie tracking app for people who want a focused, cinematic way to discover titles, maintain a watchlist, track episodes, review what they watched, and understand their viewing history. It combines a React Native mobile client with a Django API that caches TMDB data and uses TVmaze for release-time enrichment.

Primary product loop:

1. Sign in or create an account.
2. Discover a show or movie through Discover, Search, or curated recommendations.
3. Add it to the appropriate watchlist.
4. Mark episodes or movies watched as they are completed.
5. Use Upcoming, History, Reviews, Community, Lists, and Analytics to turn that activity into useful follow-up actions.

## Visual Direction

Glix uses an adaptive cinematic glass system rather than a generic dashboard style.

- **Dark mode:** OLED black background, translucent graphite glass, hairline white borders, white hierarchy text, Cinema Neon Yellow accent.
- **Light mode:** cool paper background, raised near-white surfaces, inky text, the same neon accent used as a dark readable ink token where needed.
- **Accent:** Cinema Neon Yellow `#E4FA1A` as a fill with dark text; `accentInk` is used when yellow needs to sit on a light background.
- **Destructive state:** red is reserved for errors and destructive actions.
- **Depth:** blur underneath translucent glass, hairline borders, image scrims, restrained shadows in light mode.
- **Shape language:** rounded cards and sheets, compact pills, circular avatars, no excessive nesting of cards.
- **Typography:** custom Akony branding is used for the wordmark; screen typography follows the existing React Native theme and hierarchy tokens.

New UI must use `useAppTheme().theme.colors`, the shared glass/surface primitives, `PressableScale` for normal actions, `FlashList` for long lists, `expo-image` for remote media, and `lucide-react-native` for icons. Do not introduce a new hue family, icon library, or ad-hoc glass recipe.

## Navigation Map

The app has **30 route files under `client-mobile/app/`**, including two layouts. There are **29 active route surfaces** because `app/(tabs)/upcoming.tsx` is a retired redirect stub. The active surfaces are grouped below.

### Entry and account

| Route | Purpose | How reached |
|---|---|---|
| `login.tsx` | Email/password login plus Google and Apple sign-in | App launch when signed out |
| `register.tsx` | Account creation plus social sign-up | Login |
| `forgot-password.tsx` | Email OTP request, verification, and password reset | Login |
| `loading.tsx` | Authenticated bootstrap, server warm-up, profile/watchlist prefetch, animated splash hand-off | Login/register/reset success |
| `onboarding.tsx` | First-use quick-add and initial setup | New account flow |

### Main tabs

| Route | Purpose | Main capabilities |
|---|---|---|
| `(tabs)/index.tsx` | Shows Hub | Watch List, Upcoming, Watch History, list/grid/calendar layouts, anime split, catch-up, season progress, completion celebration |
| `(tabs)/movies.tsx` | Movies Hub | Watch Next, Watched, Last Watched, list/grid layouts, filters, watch/unwatch |
| `(tabs)/discover.tsx` | Discover Hub | Hero carousel, Series/Movies segments, Trending/Popular/Top Rated, genres, languages, anime filter, search/filter pagination, For You |
| `(tabs)/profile.tsx` | Profile Hub | Account summary, watch-time stats, social counts, My Shows, My Movies, My Anime, Reviews, Lists, Settings |
| `(tabs)/upcoming.tsx` | Retired redirect | Kept for route compatibility; not a separate active tab surface |

### Media and tracking

| Route | Purpose |
|---|---|
| `search.tsx` | Universal search for shows and movies; add or open results |
| `show/[id].tsx` | Show detail, watchlist actions, favorite, trailer, providers, reviews, comments, lists, rewatch state |
| `show/[id]/season/[season].tsx` | Season episode list, progress, bulk mark watched, catch-up, rewatch episode toggles |
| `show/[id]/comments.tsx` | Show discussion thread, replies, likes, reports |
| `episode/[id].tsx` | Episode detail, credits, interaction, watch action |
| `movie/[id].tsx` | Movie detail, watchlist/watch state, trailer, providers, review, lists, rewatch |

### Profile, social, and insight screens

| Route | Purpose |
|---|---|
| `profile/shows.tsx` | My Shows with status, language, filters, last-watched sort, list/grid layout |
| `profile/movies.tsx` | My Movies with status, language, animation tag, last-watched sort, list/grid layout |
| `profile/anime.tsx` | My Anime across TV and movies, segmented by media type |
| `profile/reviews.tsx` | Personal review and rating history |
| `community.tsx` | Discussions, review-based activity feed, people search/following |
| `user/[username].tsx` | Public profile for non-private users |
| `user/[username]/connections.tsx` | Followers and following lists |
| `analytics.tsx` | Shows/Movies analytics dashboard, charts, ratings, language, monthly strip |
| `statistics.tsx` | Detailed statistics and monthly/yearly views |
| `achievements.tsx` | Badge progress and earned achievements |
| `year-review.tsx` | Year in Review summary and shareable image export |

### Utility and lists

| Route | Purpose |
|---|---|
| `settings.tsx` | Theme, default layout, username/photo editing, notification preferences, data actions, logout |
| `lists/index.tsx` | User-created lists with All/Shows/Movies filtering and quick create |
| `lists/[id].tsx` | List detail, media items, remove item, delete list |

## Feature Inventory

### Authentication and identity

- JWT access/refresh authentication with automatic refresh and transient-failure protection.
- Email/password registration and login.
- Google and Apple ID-token verification on the backend.
- Forgot-password flow using email OTP, verification, expiry, attempt limits, and one-time reset tokens.
- Editable username with case-insensitive validation and database-race handling.
- Avatar picker with generated cartoon, character, and abstract icon options.
- Adaptive System/Light/Dark theme preference.

### Shows and episodes

- TMDB-backed show search and detail pages.
- Watchlist add, remove, undo, favorite, archive, and catch-up preference.
- Episode-level watched/unwatched state.
- Bulk season marking and catch-up detection for previously aired episodes.
- Watch List buckets: Watch Next, Upcoming, Watch History, Haven't Watched for a While, Haven't Started, and status-aware progress states.
- Calendar grouping and local release-date display.
- Exact per-episode air instants when TVmaze provides them; show-level slot or local-date fallback when it does not.
- Unreleased episode protection enforced on the server and reflected in the client.
- Ended/canceled series completion detection with non-blocking confetti/banner celebration.
- Anime split based on Animation genre plus Japanese original language for the Shows Hub and My Anime surface.

### Movies

- TMDB-backed movie search and detail pages.
- Movie watchlist add/remove/undo and watched/unwatched state.
- Watch Next, Watched, and Last Watched views.
- Animation filtering and language filtering.
- Runtime, release date, genres, providers, trailer, reviews, lists, and rewatch actions.
- Movie analytics kept separate from TV analytics so existing TV numbers are not changed.

### Discovery and recommendations

- Hero carousel and image-led discovery feed.
- Independent Series and Movies feeds.
- Trending, Popular, Top Rated, Critically Acclaimed, genre, language, and anime filtering.
- Search results with paginated loading and duplicate-result protection.
- Personalized For You feed seeded by the user's watched/rated library and cached per media type.
- Detail-page recommendations and watch-provider information.
- YouTube trailer hand-off through the native browser/app.

### Reviews, community, and social

- Private-by-default show and movie ratings using half-star increments from 0.5 to 5.0.
- Private notes with explicit save feedback.
- Review creation gated on having watched the title; deletion remains available.
- Show comments, nested replies, likes, reports, and moderation fields.
- Follow graph, people search, followers/following, public profiles, and privacy/ghost mode.
- Community activity feed based on followed users' reviews rather than raw watch events.
- Paginated comments/activity feeds using FlashList on the client.

### Lists and rewatching

- User-created lists containing shows and movies.
- Add-to-list sheet from media detail pages.
- Media-aware list filtering and membership toggles.
- Show rewatch rounds with per-episode state, completion, cancellation, and rewatch minutes.
- Movie rewatch event count with removal of the most recent event.
- Rewatch data remains parallel to the original `WatchState` model so first-watch invariants stay intact.

### Analytics and achievement system

- Dashboard metrics for watched time, shows, movies, completion, and rewatch time.
- Genre, MVP character, provider, completion, streak, heatmap, monthly summary, year review, and achievement endpoints.
- Full-history sparse heatmap grouped by year plus recent streak views.
- Movie analytics: languages, decades, monthly totals, watched-this-year titles, runtimes, ratings, and distribution.
- Badge thresholds, unlock presentation, watch streak tracking, and admin resync tools.
- Year Review image capture and native share sheet.

### Import, widgets, and notifications

- TV Time JSON import with validation, external-id resolution, chunked Celery processing, progress polling, idempotent retries, and stalled-job recovery.
- Shows and movies export/import helpers in the client migration module.
- Android and iOS Upcoming widgets with local air-time resolution, future-item filtering, offline snapshots, multi-item grouping, resize-aware rendering, and privacy-aware logged-out state.
- Expo push-token registration, new-episode alerts, weekly digest, foreground presentation, and dead-token cleanup.
- Render cold-start health probing with a user-visible waking state and retry/error state.

## How the System Works

### Client request flow

1. Expo Router loads the route under `client-mobile/app/`.
2. The route reads theme and domain state from the relevant Zustand store.
3. Network calls use the shared Axios instance in `client-mobile/lib/api.ts`.
4. The interceptor attaches the JWT, refreshes on a real 401/403, and preserves tokens across transient refresh failures.
5. Stores apply optimistic updates where the interaction benefits from immediate feedback, keep rollback snapshots, and reconcile with the server response.
6. Persisted stores use AsyncStorage through the hydration-aware debounced adapter; tokens use SecureStore.
7. Image content comes from cached backend payloads and TMDB image URLs through `expo-image`.

### Backend request flow

1. Django routes `/api/v1/` requests through `backend/core/urls.py` and the included feature URL modules.
2. Authenticated views scope user-owned data by the authenticated user.
3. TMDB access is centralized in `core/services.py`; views do not call TMDB directly.
4. Cached show/movie data is stored in PostgreSQL and responses use Redis-backed caching where appropriate.
5. Celery handles imports, cache refreshes, air-time enrichment, notifications, badge/streak work, and stalled-import recovery.
6. Signals invalidate affected caches and maintain profile/badge/streak side effects, with explicit handling for bulk operations that bypass Django save signals.
7. DRF serializers define the client contract; pagination uses `StandardResultsPagination` for long feeds.

### Source data responsibilities

- **TMDB:** titles, posters/backdrops, descriptions, genres, ratings, seasons, episodes, credits, providers, videos, recommendations, release dates.
- **TVmaze:** show/episode release-time enrichment via schedules and episode airstamps.
- **PostgreSQL:** user identity, cached media, watch state, reviews, comments, follows, lists, rewatch history, import jobs, preferences, and analytics source data.
- **Redis:** cache, password-reset OTP/token state, Celery broker/result infrastructure, short-lived response data.
- **AsyncStorage:** client state and preferences that are safe to persist locally.
- **SecureStore:** access and refresh tokens.

## State Ownership

There are six Zustand stores. The old "single global store" description is obsolete.

| Store | Owns |
|---|---|
| `watchStore.ts` | Shows, episodes, movies, watch history, profile, analytics fetches, catch-up, completion, import state |
| `discoverStore.ts` | Feed segments, search/filter results, genres, pagination, For You data |
| `listsStore.ts` | Custom lists, list detail, membership, create/update/delete actions |
| `socialStore.ts` | Community tabs, people, follows, public profiles, connections, activity |
| `preferencesStore.ts` | Default layout and per-screen layout overrides |
| `themeStore.ts` | System/Light/Dark preference and resolved theme |

## Backend Surface

The backend exposes the following feature groups below `/api/v1/`:

- Health and authentication: health, register, login, logout, refresh, Google, Apple, password reset.
- Tracking: show/movie watchlists, add/remove, favorite/archive, episode/movie watch state, bulk toggle, catch-up, history, interactions, continue watching.
- Profile: profile, avatar options, stats resync, notification preferences.
- Import: TV Time submission and job status.
- Discovery: feed, filters, genres, show/movie search, universal search, detail, season, episode, credits, providers, recommendations, trailers.
- Community: comments, replies, likes, reports, reviews, lists, personalized recommendations, follows, profiles, connections, activity, rewatch.
- Analytics: dashboard, statistics, genres, MVP characters, providers, completion, movies, heatmap, streak, year review, monthly summary, achievements.

The exact route declarations are in `backend/core/urls.py` and the feature-specific `*_urls.py` modules. The exact database schema is in `backend/core/models.py` and migrations.

## Verification and Known Limits

Verified project checks as of 2026-09-08 include backend `pytest` 241/241, client Jest 69/69, client `npm run typecheck` with zero errors, Django checks, migration checks, and a successful Docker build for the latest production audit batches.

Still requiring a physical device or deployed environment:

- Native widget appearance and resize behavior.
- Real push notification delivery and permissions.
- OAuth handshakes using production provider configuration.
- Full visual review of light/dark screens and animation feel.
- Real Render cold-start timing after deployment.

Current production deployment requirement: set a real `EXPO_PUBLIC_API_URL` in the EAS production profile before building a production client. The placeholder must not ship to users.

## Related Documentation

- [CONTEXT.md](CONTEXT.md): current architecture and product reference.
- [PROJECT_STATUS.md](PROJECT_STATUS.md): detailed implementation history and verification log.
- [ROADMAP.md](ROADMAP.md): phase checklist and remaining work.
- [AUDIT.md](AUDIT.md): historical audit findings and resolutions.
- [DEPLOYMENT_READY.md](DEPLOYMENT_READY.md): deployment checklist and blockers.
- [WATCHTRACKER_AI_PLAYBOOK/AI_RULES.md](WATCHTRACKER_AI_PLAYBOOK/AI_RULES.md): coding-agent rules.
