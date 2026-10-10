# GLIX refinements — 10 October 2026

This update is prepared for the requested commit and push to `main`. No separate
production deployment, OTA publication, native APK installation, dependency
upgrade, or database migration was performed.

## Watch Next and Android widgets

- **Root cause: completed shows offered their watched finale as the next episode.**
  `pickNextEpisode` returned the last cached episode when no unwatched episode
  remained. Partial season coverage and stale aggregate counts kept the row in
  Watch Next, where it appeared ticked. The shared picker now returns null;
  watched finales disappear from the queue and Next Up widget. Genuinely missing
  episode data retains its existing recovery row. Successful catch-up operations
  involving server-cached predecessor episodes refetch authoritative counts and
  history. Individual toggles, future episodes, undo and completion guards remain.
- **Root cause: the durable native snapshot was never reliably written/read.**
  `react-native-shared-preferences` exports CommonJS, but both callers requested
  `.default`. The fallback depended on the large persisted watch store. A shared
  adapter now supports both export shapes and writes a small independent
  AsyncStorage snapshot. Native reads have a bounded callback timeout.
- Resize paints the saved snapshot immediately, without opening the app or
  fetching the network. Scheduled updates paint cached content before refreshing;
  offline failures retain it. A newer foreground update or logout wins over an
  older in-flight network response. Empty and logged-out snapshots are authoritative.
- Startup cannot replace saved widget content with an unhydrated empty store.
  The root auth guard also updates immediately on login/logout; previously its
  boot-only auth state disabled background syncing after a fresh login.
- The normal-height UpcomingWidget and WatchlistWidget renderers were unchanged.
  Handler regression tests cover heights 140 and 400; launcher/device behaviour
  still needs a native phone check.

## UI, Discover and release data

- Shared top tabs use smaller text and insets while preserving 48dp touch targets.
  Shows, Discover, My Anime and the other consumers receive the same treatment.
  Changing a shared tab adds a selection haptic; tapping the active tab does nothing.
- The series calculator now has 20dp separation below streaming providers.
- OTT access choices live in one Access picker. Platform copy is “Select platforms”
  with a short selection-limit hint. New releases is a release-window filter,
  independent of genre, and combines with country, platforms, genre, language,
  anime, access and pagination. Trending switches to compatible discovery sorting.
- Release rails merge up to two TMDB pages, deduplicate titles and cap at 40.
  Query-specific 30-minute caches and six-hour backups preserve useful results
  during outages. Successful empty results remain authoritative; saved backups
  are visibly labelled. Client release data expires after 30 minutes.
- TVmaze supplements TV rails using exact recent episode timestamps already
  maintained by the app, requiring cached platform evidence for the selected
  country and access type. It does not infer India availability from a US network.
- Optional `WATCHMODE_API_KEY` enables the free US movie calendar only for US
  rails with any-access and no platform restriction. It never substitutes US
  release dates for Indian releases or bypasses a platform filter. No key was
  provisioned. India movie releases remain based on TMDB regional digital dates;
  another free worldwide regional digital-release calendar was not verified.
- Supplemental sources are linked on the release rail. These TV rails describe
  **recent episodes**, not the date a title joined a streaming platform.

## Analytics and Year in Review

- Shows watch time now sums series first watches and series rewatches separately
  from movies. Existing combined Profile totals remain available.
- Movie watch time includes repeat watches, with an explicit repeat count/time.
  Average film length excludes unknown zero runtimes. Movie analytics refreshes
  on focus or new activity instead of displaying a permanently cached result.
- Added show/movie backlog cards, a 30-day first-watch series pace, average film
  length and the current month's movie count. Caught-up counts require full
  season coverage, matching the mobile watchlist guard.
- Year in Review combines movie and series first watches and rewatches, with
  separate hours, unique title counts, repeats, active days, year-specific streak,
  busiest date/week/month, weekday rhythm, personal ratings and genre highlights.
- Twelve monthly chapters show split minutes, watch counts and top titles.
  Users can switch among years represented in their history. The current year
  is labelled “year so far”; boundaries use the device's IANA timezone.
- A complete virtualized library lists every show/movie watched in that year,
  including dates, time, repeat counts and current personal ratings. Top shows
  rank by viewing time; movie highlights rank by personal rating, then repeats.
- Sharing captures a branded summary with both media types. Temporary captures
  are released after sharing. Share availability/errors are handled in the UI.
- Counts come from logged dates, including imported history and manual bulk
  marks. Unknown runtime watches are disclosed. Ratings are today's ratings,
  not historical snapshots. “Shows finished” requires finalized series with
  full known coverage and a final first-watch timestamp inside that year.
- Scalar ORM rows stream in chunks; rankings and the library reuse one pass.
  A regression check bounds query count independently of library size.

## Lifecycle/performance audit and remaining validation

- Cold SecureStore reads cannot overwrite a newly rotated token or restore a
  logged-out token; their timeout is cleaned up. Auth subscriptions unsubscribe.
- Deferred OTA work cancels its timer and avoids reload after unmount. Background
  widget requests have an abort deadline. Saved widget data avoids loading a large
  episode graph for each resize. Large yearly title lists use FlashList.
- Review covered watch/catch-up flows, widget storage/headless lifecycle,
  Discover filters/caches, analytics and yearly history, token state, root lifecycle,
  and timer/listener patterns across app/components/lib/store. It was a code audit
  plus automated checks, not a complete interactive test of every app feature.
- Next useful validation: native launcher resize after force-close/reboot/offline,
  accessibility at large font scale, sharing on Android/iOS, and measured memory/
  frame-time profiles on both phones. No maximum-speed or zero-leak hardware claim
  is made. Account-scoped cache resets and paginated large-library loading merit
  a separate focused review rather than an unverified cross-store rewrite here.

## Safe dead-code cleanup

- Traced TypeScript imports across routes, components, libraries, stores,
  widgets and tests. Removed the orphaned `ActorChart` component and unused
  `Segment` interface. Retained helpers and types used inside their own modules.
- Removed ten unused production Python imports, an unused test import and an
  unused test binding. The TMDB proxy test now asserts a fetched, cached show
  instead of swallowing every exception and passing without assertions.
- The core unused-import/variable scan is clear. Preserved Django settings
  imports, admin registrations, signal receivers, task entry points and handlers
  referenced by configuration strings. Project instructions and development
  tooling remain available.

## Research and tools

- [Spotify Wrapped stories and sharing](https://newsroom.spotify.com/2025-12-03/2025-wrapped-user-experience/)
  informed the personal highlights and summary card.
- [Apple Replay](https://support.apple.com/en-gb/109356) informed monthly chapters
  and year-round revisiting. [Letterboxd yearly summaries](https://letterboxd.zendesk.com/hc/en-us/articles/14756734879759-How-can-I-view-my-Letterboxd-Wrapped)
  provided film-recap context.
- [TMDB region support](https://developer.themoviedb.org/docs/region-support),
  [TVmaze API](https://www.tvmaze.com/api), and [Watchmode API docs](https://api.watchmode.com/docs)
  informed the regional evidence and fallback boundaries.
- Applied Caveman communication, UI/UX Pro Max and Surgical Patch. Prompt Master
  was consulted; its own scope excludes coding tasks. Used local source/CLI tools
  and web research; no unrelated plugin installation was needed.

## Verification

- Final full backend core run after cleanup: **274 passed**; the strengthened
  TMDB proxy test exposed its outdated class call and transport mock. After
  correcting that test setup, the entire service file passed **8 tests**.
  Together these runs verify all **275 distinct backend tests**; the full suite
  was not repeated after the test-only correction.
- Final full mobile run after cleanup: **108 passed, 19 suites**, including
  movie-only recap, cold-widget integration, auth subscription and token races.
- Strict TypeScript checks and production Expo web export passed. Production
  Android JavaScript/Hermes export also passed, including the headless widget path.
- Git whitespace checks passed. Native APK/device/launcher checks remain as above.
