// client-mobile/store/watchStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { buildWidgetPayload } from '../lib/widgetPayload';
import { WatchlistWidget as AndroidWatchlistWidget } from '../widgets/android/WatchlistWidget';
import { UpcomingWidget as AndroidUpcomingWidget } from '../widgets/android/UpcomingWidget';

// The native module is only available after a full native build (EAS /
// expo run:android) — null during Expo Go / dev-client sessions. Guarded
// the same way as widgets/android/WidgetProvider.tsx's own safe require;
// a plain top-level `import` here left this module's own setItem call
// unguarded even though WidgetProvider.tsx's copy was already fixed.
let SharedPreferences: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SharedPreferences = require('react-native-shared-preferences').default;
} catch (_e) {
  // not yet linked — silently continue without widget data persistence
}

// iOS widgets (expo-widgets) push data via Widget.updateSnapshot() rather
// than shared file storage — this only resolves on iOS after a native
// build, so it's guarded the same defensive way as SharedPreferences above.
let IOSWidgets: { WatchlistWidget?: { updateSnapshot: (props: any) => void }; UpcomingWidget?: { updateSnapshot: (props: any) => void } } = {};
if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    IOSWidgets.WatchlistWidget = require('../widgets/ios/WatchlistWidget').WatchlistWidget;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    IOSWidgets.UpcomingWidget = require('../widgets/ios/UpcomingWidget').UpcomingWidget;
  } catch (_e) {
    // widget extension target not built yet (Expo Go / dev-client before EAS build)
  }
}

export type LayoutMode = 'list' | 'grid';
/** One entry per screen that owns its own list/grid choice — see
 *  defaultLayout/layoutOverrides on WatchStoreState. */
export type LayoutScope = 'shows' | 'movies' | 'myShows' | 'myMovies' | 'myAnime';

export interface Episode {
  tmdb_id: number;
  show: number;
  season_number: number;
  episode_number: number;
  title: string;
  /** Absent on episodes embedded in a WatchlistEntry (GET /watchlist/) —
   *  the backend serves a lean episode shape there (see LEAN_EPISODE_FIELDS
   *  in serializers.py) since nothing reading `entry.show.episodes` needs a
   *  full paragraph of prose per episode, and a 400+ show library made that
   *  the single biggest contributor to the Shows Hub's response size.
   *  Always present on episodes from the dedicated season/episode
   *  endpoints (SeasonEpisodesView, EpisodeDetailView) that
   *  EpisodeRow.tsx / app/episode/[id].tsx actually render it from. */
  overview?: string;
  air_date: string | null;
  /** Exact UTC instant this episode airs, from TVmaze's per-episode
   *  `airstamp` (backend: CachedEpisode.air_datetime, core/airtime.py) —
   *  present even for streaming originals with no fixed weekly slot,
   *  unlike Show.airs_time/airs_timezone. Null until a background sync has
   *  matched it. Resolve with lib/dateFormat.ts's resolveAirInstant, which
   *  falls back to the show's slot, then to local midnight. */
  air_datetime?: string | null;
  runtime_minutes: number;
  /** Same lean-shape caveat as `overview` above. */
  still_path?: string | null;
  is_watched: boolean;
}

export interface Show {
  tmdb_id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string | null;
  status: 'RETURNING' | 'ENDED' | 'CANCELED' | 'IN_PRODUCTION';
  vote_average: number;
  total_seasons: number;
  total_episodes: number;
  /** ISO 639-1 code from TMDB (e.g. "en", "ko", "ja"). Blank for shows
   *  cached before this field existed, until their next TMDB refresh. */
  original_language: string;
  genres: string[];
  /** From TMDB's `next_episode_to_air` — populated even before that season's
   *  individual episodes are otherwise cached (a freshly-announced season
   *  with only a premiere date confirmed). Null once nothing is scheduled. */
  next_episode_air_date: string | null;
  /** Exact UTC instant for next_episode_air_date, from TVmaze's per-episode
   *  airstamp — same source/caveats as Episode.air_datetime. Null whenever
   *  TVmaze doesn't know this specific episode yet. */
  next_episode_air_datetime?: string | null;
  next_episode_season_number: number | null;
  next_episode_number: number | null;
  next_episode_name: string | null;
  /** The network's broadcast slot from TVmaze (backend: CachedShow /
   *  core/airtime.py) — `airs_time` is a wall clock ("21:30") that only
   *  means anything paired with `airs_timezone` (an IANA name). TMDB has
   *  no air-time data at all, which is why this comes from a second
   *  source. Both null/blank for shows with no fixed slot (most streaming
   *  originals) and for shows cached before this field existed, until
   *  their next background refresh. Resolve with lib/dateFormat.ts's
   *  formatLocalAirTime rather than reading `airs_time` directly — it is
   *  NOT in the device's timezone. */
  airs_time?: string | null;
  airs_timezone?: string | null;
  episodes: Episode[];
  /** YouTube video id for the best available trailer/teaser, only present
   *  on the full ShowDetailView response (`GET /shows/{id}/`) — absent
   *  (undefined) on the lighter show shape embedded in watchlist entries. */
  trailer_key?: string | null;
}

/** Phase 75.7 — an in-progress rewatch round for this show. Null unless
 *  the user has an active round (see store's startShowRewatch);
 *  watched_episode_count/aired_episode_count are scoped to THIS round,
 *  not the original watch-through (watched_episode_count/
 *  aired_episode_count on WatchlistEntry itself). */
export interface ActiveRewatch {
  round_number: number;
  watched_episode_count: number;
  aired_episode_count: number;
}

/** GET /rewatch/shows/<tmdb_id>/'s shape — the per-episode detail
 *  show/[id].tsx needs to render rewatch-aware checkmarks, distinct from
 *  ActiveRewatch's list-view summary above (no per-episode ids there). */
export interface ShowRewatchDetail {
  round_number: number;
  watched_episode_ids: number[];
  aired_episode_count: number;
  completed: boolean;
}

export interface WatchlistEntry {
  id: number;
  show: Show;
  status: 'TO_WATCH' | 'UP_TO_DATE' | 'ARCHIVED';
  is_favorite: boolean;
  ignore_catchup: boolean;
  watched_episode_count: number;
  aired_episode_count: number;
  progress_percentage: number;
  /** ISO timestamp of the most recent episode watch for this show, or null
   *  if nothing watched yet. Drives recency-aware Shows Hub pill sorting. */
  last_watched_at: string | null;
  active_rewatch: ActiveRewatch | null;
  added_at: string;
  updated_at: string;
}

export interface WatchlistPage {
  count: number;
  total_pages: number;
  current_page: number;
  next: string | null;
  previous: string | null;
  results: WatchlistEntry[];
}

export interface WatchlistBuckets {
  to_watch: WatchlistPage;
  up_to_date: WatchlistPage;
  archived: WatchlistPage;
}

export interface HistoryEntry {
  id: string;
  episode: Episode;
  show_id: number;
  show_title: string;
  show_poster_path: string | null;
  watched_at: string;
}

export interface HistoryPage {
  count: number;
  total_pages: number;
  current_page: number;
  next: string | null;
  previous: string | null;
  results: HistoryEntry[];
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  profile_picture: string | null;
  is_private: boolean;
  total_time_watched: number;
  watched_days: number;
  watched_hours: number;
  watched_minutes: number;
  earned_badges: string[];
  follower_count: number;
  following_count: number;
  created_at: string;
}

export type Emotion = 'HAPPY' | 'SHOCKED' | 'SAD' | 'GOOD' | 'FUN';

interface ToggleResponse {
  episode_id: number;
  watched: boolean;
  total_time_watched: number;
  newly_earned_badges?: string[];
}

interface BulkToggleResponse {
  episode_ids: number[];
  /** Ids the server actually created/deleted a WatchState row for — a
   *  subset of episode_ids when some requested ids were unaired (see
   *  skipped_unaired_ids). */
  applied_episode_ids?: number[];
  /** Requested ids the server refused because the episode hasn't aired
   *  yet — the client's optimistic update marks all requested ids
   *  watched before this response arrives, so these need reconciling. */
  skipped_unaired_ids?: number[];
  watched: boolean;
  total_time_watched: number;
  newly_earned_badges?: string[];
}

interface MovieToggleResponse {
  movie_id: number;
  watched: boolean;
  total_time_watched: number;
  newly_earned_badges?: string[];
}

interface ShowRemoveResponse {
  show_id: number;
  watched_episode_ids: number[];
  was_favorite: boolean;
  was_status: 'TO_WATCH' | 'UP_TO_DATE' | 'ARCHIVED';
  was_ignore_catchup: boolean;
  total_time_watched: number;
}

interface MovieRemoveResponse {
  movie_id: number;
  was_watched: boolean;
  total_time_watched: number;
}

/** Everything ShowRemoveView deleted, server-authoritative — Undo replays
 *  this exactly (re-add, restore favorite/status/ignore_catchup, re-mark
 *  these exact episode ids) rather than trusting whatever the client had
 *  cached locally, same reasoning as CatchupCheckView. */
export interface RemovedShowSnapshot {
  showId: number;
  watchedEpisodeIds: number[];
  wasFavorite: boolean;
  wasStatus: 'TO_WATCH' | 'UP_TO_DATE' | 'ARCHIVED';
  wasIgnoreCatchup: boolean;
}

export interface RemovedMovieSnapshot {
  movieId: number;
  wasWatched: boolean;
}

/** Phase 67 — payload for the series-finished celebration. See
 *  WatchStoreState.completedShow. */
export interface CompletedShowInfo {
  showId: number;
  title: string;
  posterPath: string | null;
}

export interface MovieEntry {
  tmdb_id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  runtime_minutes: number;
  genres_string: string;
  vote_average: number;
  /** ISO 639-1 code from TMDB (e.g. "en", "ko", "ja"). Blank for movies
   *  cached before this field existed, until their next TMDB refresh. */
  original_language: string;
  is_watched: boolean;
}

export interface MovieWatchlistItem {
  id: number;
  movie: MovieEntry;
  added_at: string;
  updated_at: string;
  /** When this movie was actually marked watched (null if never/not yet) —
   *  distinct from updated_at, which bumps on any change to the tracking
   *  row. Powers the Movies Hub's "Last Watched" pill sort. */
  watched_at: string | null;
  /** How many times this movie has been rewatched (Phase 75.7) — 0 unless
   *  the user has tapped "Watch again" at least once. Independent of
   *  watched_at/is_watched, which only ever reflect the original watch. */
  rewatch_count: number;
}

export interface MovieWatchlistBuckets {
  watch_next: MovieWatchlistItem[];
  watched: MovieWatchlistItem[];
}

const EMPTY_PAGE: WatchlistPage = {
  count: 0,
  total_pages: 1,
  current_page: 1,
  next: null,
  previous: null,
  results: [],
};

const EMPTY_HISTORY_PAGE: HistoryPage = {
  count: 0,
  total_pages: 1,
  current_page: 1,
  next: null,
  previous: null,
  results: [],
};

// ─── Analytics types ────────────────────────────────────────────────────────

export interface WatchTimeSummary {
  total_minutes: number;
  total_hours: number;
  total_days: number;
  avg_minutes_per_day: number;
  avg_minutes_per_week: number;
  avg_minutes_per_month: number;
}

export interface AnalyticsDashboard {
  total_episodes_watched: number;
  total_shows_tracked: number;
  total_minutes_watched: number;
  total_hours_watched: number;
  total_days_watched: number;
  current_streak: number;
  longest_streak: number;
  total_streak_days: number;
  badges_earned: number;
  shows_completed: number;
  shows_archived: number;
  watch_time: WatchTimeSummary;
}

export interface PeriodStat {
  period: string;
  label: string;
  episodes_watched: number;
  minutes_watched: number;
}

export interface TopShow {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  episodes_watched: number;
}

export interface AnalyticsStatistics {
  watch_time: WatchTimeSummary;
  daily: PeriodStat[];
  weekly: PeriodStat[];
  monthly: PeriodStat[];
  yearly: PeriodStat[];
  top_shows: TopShow[];
  most_watched_day: string | null;
}

export interface GenreStat {
  genre: string;
  episodes_watched: number;
  shows_watched: number;
  percentage: number;
}

export interface HeatmapDay {
  date: string;
  episodes_watched: number;
  minutes_watched: number;
  intensity: number;
}

/** One year's rollup from GET /analytics/heatmap/?range=all — `days` is
 *  sparse (only days with activity), not a dense 365-entry fill like
 *  `heatmap` above. See core/analytics_views.py::_heatmap_all_time_for_user. */
export interface HeatmapYear {
  year: number;
  episodes_watched: number;
  minutes_watched: number;
  days_active: number;
  max_episodes_in_a_day: number;
  days: HeatmapDay[];
}

export interface StreakData {
  current_streak: number;
  longest_streak: number;
  total_streak_days: number;
  last_watch_date: string | null;
  recent_activity: HeatmapDay[];
}

export interface YearReview {
  year: number;
  hours_watched: number;
  episodes_watched: number;
  shows_finished: number;
  most_watched_show: TopShow | null;
  favorite_genre: string | null;
  favorite_actor: string | null;
  longest_streak: number;
  biggest_month: string | null;
  biggest_week: string | null;
  top_shows: TopShow[];
  top_genres: { genre: string; count: number }[];
}

export interface MonthlySummaryItem {
  month: string;
  label: string;
  hours_watched: number;
  episodes_watched: number;
  shows_finished: number;
  top_genre: string | null;
  top_show: TopShow | null;
}

export interface AchievementItem {
  slug: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  earned: boolean;
  progress: number;
  progress_label: string;
}

export interface CompletionData {
  episode_completion_pct: number;
  season_completion_pct: number;
  show_completion_pct: number;
  movie_completion_pct: number;
  movies_watched: number;
  movies_tracked: number;
  episodes_watched: number;
  episodes_aired: number;
  shows_completed: number;
  shows_total: number;
}

export interface LongestMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  runtime_minutes: number;
}

export interface DecadeStat {
  decade: string;
  count: number;
}

export interface RecentMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  watched_at: string;
}

/** GET /analytics/movies/ — the Movies-segment counterpart to the
 *  TV-only `dashboard`/`genres`/`completion` above (Phase 74/Group H).
 *  Kept as its own slice, not merged into the existing fields, since the
 *  whole point of this addition was "existing TV numbers must not
 *  change." */
export interface MovieAnalytics {
  movies_watched: number;
  movies_tracked: number;
  completion_pct: number;
  total_runtime_minutes: number;
  average_runtime_minutes: number;
  watched_this_year: number;
  longest_movie: LongestMovie | null;
  top_genres: { genre: string; count: number; percentage: number }[];
  by_decade: DecadeStat[];
  recent_movies: RecentMovie[];
}

interface AnalyticsSlice {
  dashboard: AnalyticsDashboard | null;
  statistics: AnalyticsStatistics | null;
  genres: GenreStat[];
  heatmap: HeatmapDay[];
  heatmapAll: HeatmapYear[];
  isLoadingHeatmapAll: boolean;
  movieAnalytics: MovieAnalytics | null;
  isLoadingMovieAnalytics: boolean;
  streak: StreakData | null;
  yearReview: YearReview | null;
  monthlyRecap: MonthlySummaryItem[];
  achievements: AchievementItem[];
  completion: CompletionData | null;
  isLoadingAnalytics: boolean;
  analyticsError: string | null;
  unlockedBadges: string[];
}

// ─── Store interface ─────────────────────────────────────────────────────────

interface WatchStoreState extends AnalyticsSlice {
  watchlist: WatchlistBuckets;
  movieWatchlist: MovieWatchlistBuckets;
  history: HistoryPage;
  profile: UserProfile | null;
  isLoadingWatchlist: boolean;
  isLoadingMovies: boolean;
  isLoadingHistory: boolean;
  isLoadingProfile: boolean;
  isResyncingStats: boolean;
  /** Timestamp of the most recent watch-affecting mutation (bumped inside
   *  fetchProfile — see its own comment). Screens with an expensive
   *  focus-triggered refetch (analytics.tsx, profile.tsx) compare this
   *  against what they last saw to skip a redundant refetch when nothing
   *  has actually changed, without needing a signal threaded through every
   *  individual toggle/bulk-toggle/rewatch action. */
  analyticsDirtyAt: number;
  error: string | null;

  /** App-wide default (Settings > Appearance), plus a per-screen override
   *  map — Shows Hub, Movies Hub, Profile > My Shows/My Movies/My Anime can
   *  each pick their own layout without disturbing the others or the
   *  default. Read via useLayoutFor(scope) rather than these fields
   *  directly. Both persisted so the choice sticks across app restarts. */
  defaultLayout: LayoutMode;
  layoutOverrides: Partial<Record<LayoutScope, LayoutMode>>;
  /** Sets the app-wide default AND clears every per-screen override, so
   *  a Settings change is felt everywhere immediately rather than being
   *  masked by whatever overrides happen to already exist. */
  setDefaultLayout: (mode: LayoutMode) => void;
  setLayoutForScope: (scope: LayoutScope, mode: LayoutMode) => void;

  /** Original-language filter (ISO 639-1 code, e.g. "ko"), shared across
   *  Profile > My Shows and My Movies. Null means "All languages". Filtering
   *  happens client-side against the already-fetched watchlist/movie cache —
   *  no new API request. Persisted so the choice sticks across restarts. */
  selectedLanguage: string | null;
  setLanguageFilter: (language: string | null) => void;

  fetchWatchlist: () => Promise<void>;
  fetchHistory: (page?: number) => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfilePicture: (url: string) => Promise<boolean>;
  /** Returns null on success, or a human-readable error (already-taken,
   *  invalid characters, etc.) — the edit sheet shows this inline rather
   *  than a generic Snackbar, so the caller needs the specific message,
   *  not just a boolean. */
  updateUsername: (next: string) => Promise<string | null>;
  /** "Ghost mode" — excludes this user from search, activity feeds, and
   *  everyone else's view of their profile (core/social_views.py). */
  updateIsPrivate: (isPrivate: boolean) => Promise<boolean>;
  /** Recomputes total_time_watched (+ returns verified shows/movies counts)
   *  from source-of-truth rows on the backend, replacing whatever drift the
   *  incremental F()-expression counter accumulated. See Profile Hub's
   *  stats card — a tap-to-sync action, not a passive refetch. */
  resyncStats: () => Promise<boolean>;
  toggleWatchState: (episodeId: number) => Promise<void>;
  bulkToggleWatchState: (episodeIds: number[], watched: boolean) => Promise<void>;
  setCatchupPreference: (showId: number, ignoreCatchup: boolean) => Promise<void>;
  logInteraction: (
    episodeId: number,
    payload: { emotion_emoji?: Emotion; mvp_character_id?: number; mvp_character_name?: string }
  ) => Promise<void>;
  clearError: () => void;

  // Show actions
  addShowToWatchlist: (showId: number) => Promise<boolean>;
  /** Full delete (product decision, Phase F) — removes the Watchlist row
   *  AND every WatchState for the show's episodes, server-side. Returns a
   *  snapshot for Undo, or null if the request failed (state already
   *  rolled back). */
  removeShowFromWatchlist: (showId: number) => Promise<RemovedShowSnapshot | null>;
  undoRemoveShow: (snapshot: RemovedShowSnapshot) => Promise<void>;

  // Rewatch (Phase 75.7) — a parallel system to WatchState, never touches
  // it. showRewatchDetail is keyed by show tmdb_id and holds the one show's
  // full per-episode ticked state (show/[id].tsx's own concern); the
  // lighter `active_rewatch` summary on WatchlistEntry (round_number +
  // counts, no per-episode list) is what list views read instead.
  showRewatchDetail: Record<number, ShowRewatchDetail | null>;
  fetchShowRewatchDetail: (showId: number) => Promise<void>;
  /** Returns null on success, or a human-readable error — e.g. "watch
   *  every aired episode first." Shown inline by the caller rather than a
   *  generic Snackbar, same convention as updateUsername. */
  startShowRewatch: (showId: number) => Promise<string | null>;
  cancelShowRewatch: (showId: number) => Promise<boolean>;
  toggleRewatchEpisode: (episodeId: number, showId: number) => Promise<boolean>;

  // Movie actions
  fetchMovieWatchlist: () => Promise<void>;
  toggleMovieWatchState: (movieId: number) => Promise<boolean>;
  addMovieToWatchlist: (movieId: number) => Promise<boolean>;
  removeMovieFromWatchlist: (movieId: number) => Promise<RemovedMovieSnapshot | null>;
  undoRemoveMovie: (snapshot: RemovedMovieSnapshot) => Promise<void>;
  addMovieRewatch: (movieId: number) => Promise<boolean>;
  removeMovieRewatch: (movieId: number) => Promise<boolean>;

  // Analytics methods
  fetchDashboard: () => Promise<void>;
  fetchStatistics: () => Promise<void>;
  fetchAchievements: () => Promise<void>;
  fetchYearReview: (year?: number) => Promise<void>;
  fetchMonthlyRecap: (year?: number) => Promise<void>;
  fetchHeatmap: () => Promise<void>;
  /** Full watch history, sparse + year-grouped (?range=all) — deliberately
   *  NOT part of the useFocusEffect batch every other analytics fetch
   *  lives in; lazily fetched only when the user taps "Full history" on
   *  the Watch Activity card (Phase 74/Group G). */
  fetchHeatmapAll: () => Promise<void>;
  /** Lazy, like fetchHeatmapAll — NOT part of the useFocusEffect batch in
   *  analytics.tsx (already 6 unconditional fetches on a 4-thread Render
   *  box); fires only when the user switches to the Movies segment. */
  fetchMovieAnalytics: () => Promise<void>;
  fetchStreak: () => Promise<void>;
  fetchGenres: () => Promise<void>;
  fetchCompletion: () => Promise<void>;
  clearUnlockedBadges: () => void;
  popUnlockedBadge: () => void;
  syncWidgetData: () => Promise<void>;
  clearWidgetData: () => Promise<void>;

  /** Phase 67: set exactly when a toggle/bulk-toggle action detects a real
   *  incomplete→complete transition for an Ended show (see toggleWatchState/
   *  bulkToggleWatchState) — never derived from a render/refetch, so it
   *  can't retroactively fire for a show that was already 100% watched
   *  before this feature shipped, and can't refire just from reopening the
   *  show's screen. Single value, not a queue like unlockedBadges — a show
   *  can only make this transition once, and the two current bulk call
   *  sites (Catch-Up cascade, Mark Season Watched) are both single-show. */
  completedShow: CompletedShowInfo | null;
  clearCompletedShow: () => void;
}

function findEntryAndEpisode(
  buckets: WatchlistBuckets,
  episodeId: number
): { bucketKey: keyof WatchlistBuckets; entryIndex: number; episodeIndex: number } | null {
  const bucketKeys: (keyof WatchlistBuckets)[] = ['to_watch', 'up_to_date', 'archived'];
  for (const bucketKey of bucketKeys) {
    const entries = buckets[bucketKey].results;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const episodeIndex = entries[entryIndex].show.episodes.findIndex(
        (ep) => ep.tmdb_id === episodeId
      );
      if (episodeIndex !== -1) {
        return { bucketKey, entryIndex, episodeIndex };
      }
    }
  }
  return null;
}

export const useWatchStore = create<WatchStoreState>()(
  persist(
    (set, get) => ({
      watchlist: { to_watch: EMPTY_PAGE, up_to_date: EMPTY_PAGE, archived: EMPTY_PAGE },
      movieWatchlist: { watch_next: [], watched: [] },
      showRewatchDetail: {},
      history: EMPTY_HISTORY_PAGE,
  profile: null,
  isLoadingWatchlist: false,
  isLoadingMovies: false,
  isLoadingHistory: false,
  isLoadingProfile: false,
  isResyncingStats: false,
  analyticsDirtyAt: Date.now(),
  error: null,

  defaultLayout: 'list',
  layoutOverrides: {},
  setDefaultLayout: (mode) => set({ defaultLayout: mode, layoutOverrides: {} }),
  setLayoutForScope: (scope, mode) =>
    set((state) => ({ layoutOverrides: { ...state.layoutOverrides, [scope]: mode } })),

  selectedLanguage: null,
  setLanguageFilter: (language) => set({ selectedLanguage: language }),

  // ── Analytics state ──────────────────────────────────────────────────
  dashboard: null,
  statistics: null,
  genres: [],
  heatmap: [],
  heatmapAll: [],
  isLoadingHeatmapAll: false,
  movieAnalytics: null,
  isLoadingMovieAnalytics: false,
  streak: null,
  yearReview: null,
  monthlyRecap: [],
  achievements: [],
  completion: null,
  isLoadingAnalytics: false,
  analyticsError: null,
  unlockedBadges: [],
  completedShow: null,

  clearUnlockedBadges: () => set({ unlockedBadges: [] }),
  popUnlockedBadge: () => set((state) => ({ unlockedBadges: state.unlockedBadges.slice(1) })),
  clearCompletedShow: () => set({ completedShow: null }),

  fetchWatchlist: async () => {
    set({ isLoadingWatchlist: true, error: null });
    try {
      // page_size=all: load every entry unpaginated. The whole app derives
      // from these in-memory buckets (Profile "My Shows" count, Shows Hub,
      // Home/Upcoming tab, home-screen widget), so a paginated fetch capped
      // all of them at 20/bucket — a 200-show import read as "My Shows: 40".
      const response = await api.get<WatchlistBuckets>('/watchlist/?page_size=all');
      set({ watchlist: response.data, isLoadingWatchlist: false });
      get().syncWidgetData();
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingWatchlist: false });
    }
  },

  fetchHistory: async (page = 1) => {
    set({ isLoadingHistory: true, error: null });
    try {
      const response = await api.get<HistoryPage>(`/watch-history/?page=${page}`);
      set((state) => ({
        history: page === 1 
          ? response.data 
          : {
              ...response.data,
              results: [...state.history.results, ...response.data.results]
            },
        isLoadingHistory: false
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingHistory: false });
    }
  },

  fetchProfile: async () => {
    // Phase 75.8: every watch-affecting mutation in this store (episode/
    // movie/rewatch toggles, bulk toggles) already calls fetchProfile() to
    // refresh total_time_watched — bumping this timestamp here, in the one
    // place all of them funnel through, is what lets analytics.tsx's/
    // profile.tsx's own focus-refetch guards tell "something changed since
    // I last fetched" apart from "nothing changed, skip the refetch" without
    // threading a new signal through every individual call site.
    set({ analyticsDirtyAt: Date.now() });
    set({ isLoadingProfile: true, error: null });
    try {
      const response = await api.get<UserProfile>('/profile/');
      set({ profile: response.data, isLoadingProfile: false });
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingProfile: false });
    }
  },

  updateProfilePicture: async (url: string) => {
    const previousProfile = get().profile;
    // Optimistic — the avatar picker's own selection state closes immediately.
    set((state) => ({
      profile: state.profile ? { ...state.profile, profile_picture: url } : state.profile,
    }));
    try {
      const response = await api.patch<UserProfile>('/profile/', { profile_picture: url });
      set({ profile: response.data });
      return true;
    } catch (error) {
      set({ profile: previousProfile, error: extractErrorMessage(error) });
      return false;
    }
  },

  updateUsername: async (next: string) => {
    const previousProfile = get().profile;
    const trimmed = next.trim();
    if (!trimmed) return 'Username cannot be blank.';
    if (trimmed === previousProfile?.username) return null;
    // Optimistic — same pattern as updateProfilePicture. Not swallowed into
    // state.error on failure (unlike most other actions here) because the
    // edit sheet needs the exact validation message inline, not a Snackbar.
    set((state) => ({
      profile: state.profile ? { ...state.profile, username: trimmed } : state.profile,
    }));
    try {
      const response = await api.patch<UserProfile>('/profile/', { username: trimmed });
      set({ profile: response.data });
      return null;
    } catch (error) {
      set({ profile: previousProfile });
      return extractErrorMessage(error);
    }
  },

  updateIsPrivate: async (isPrivate: boolean) => {
    const previousProfile = get().profile;
    set((state) => ({
      profile: state.profile ? { ...state.profile, is_private: isPrivate } : state.profile,
    }));
    try {
      const response = await api.patch<UserProfile>('/profile/', { is_private: isPrivate });
      set({ profile: response.data });
      return true;
    } catch (error) {
      set({ profile: previousProfile, error: extractErrorMessage(error) });
      return false;
    }
  },

  resyncStats: async () => {
    set({ isResyncingStats: true, error: null });
    try {
      const response = await api.post<{
        total_time_watched: number;
        shows_count: number;
        movies_count: number;
      }>('/profile/resync-stats/');
      set((state) => ({
        profile: state.profile
          ? { ...state.profile, total_time_watched: response.data.total_time_watched }
          : state.profile,
        isResyncingStats: false,
      }));
      return true;
    } catch (error) {
      set({ error: extractErrorMessage(error), isResyncingStats: false });
      return false;
    }
  },

  toggleWatchState: async (episodeId: number) => {
    const location = findEntryAndEpisode(get().watchlist, episodeId);
    if (!location) {
      set({ error: `Episode ${episodeId} not found in current watchlist state.` });
      return;
    }

    const { bucketKey, entryIndex, episodeIndex } = location;
    const previousWatchlist = get().watchlist;
    const previousProfile = get().profile;
    const previousHistory = get().history;
    const entrySnapshot = previousWatchlist[bucketKey].results[entryIndex];
    const episode = entrySnapshot.show.episodes[episodeIndex];
    const optimisticWatched = !episode.is_watched;
    const runtimeDelta = optimisticWatched ? episode.runtime_minutes : -episode.runtime_minutes;
    const watchedAtIso = new Date().toISOString();

    set((state) => {
      // Only the touched bucket gets a new array/object reference — the
      // other two used to be shallow-copied unconditionally on every
      // single toggle even though nothing in them changed. That gave
      // every component subscribing to `watchlist` (and, without
      // ShowRow/ShowPosterCard's own memo — see those files — every row
      // in every bucket) a reason to re-render on a toggle that had
      // nothing to do with them, which is exactly what a checkmark tap
      // "dragging" the rest of the list along with it looks like.
      const nextWatchlist: WatchlistBuckets = {
        ...state.watchlist,
        [bucketKey]: {
          ...state.watchlist[bucketKey],
          results: [...state.watchlist[bucketKey].results],
        },
      };
      const results = nextWatchlist[bucketKey].results;
      const entry = { ...results[entryIndex] };
      const episodes = [...entry.show.episodes];
      episodes[episodeIndex] = { ...episodes[episodeIndex], is_watched: optimisticWatched };
      entry.show = { ...entry.show, episodes };
      entry.watched_episode_count = entry.watched_episode_count + (optimisticWatched ? 1 : -1);
      // Recency drives the Shows Hub bucketing (WATCH NEXT vs HAVEN'T WATCHED
      // FOR A WHILE). A just-watched episode means "watched now", so the show
      // belongs in WATCH NEXT immediately. Without this the count bumped but
      // last_watched_at stayed null, and marking the first episode of a
      // back-catalog show (next episode aired >14d ago, so not a "fresh drop")
      // jumped it straight to HAVEN'T WATCHED FOR A WHILE — and, on the Shows
      // Hub, stuck there until a full fetchWatchlist(). The server recomputes
      // the authoritative value on the next fetch; un-watching leaves it
      // untouched (the true prior timestamp isn't known client-side).
      if (optimisticWatched) entry.last_watched_at = watchedAtIso;
      entry.progress_percentage =
        entry.aired_episode_count > 0
          ? Math.round((entry.watched_episode_count / entry.aired_episode_count) * 1000) / 10
          : 0;

      // Phase 67: series-finished celebration. Fires only on the specific
      // mutation that crosses incomplete -> complete for a show whose
      // status is 'ENDED' at this moment — computed from this action's own
      // before (entrySnapshot)/after (entry) counts, never from a render or
      // refetch, so it can't retroactively fire for a show that was already
      // 100% watched before this shipped, and can't refire just from
      // reopening the show. aired_episode_count is the same denominator
      // progress_percentage already uses above; for an Ended show every
      // episode has aired, so "aired" here means "every episode of the
      // series." Only the marking direction can cross this threshold.
      const justCompletedShow =
        optimisticWatched &&
        entry.show.status === 'ENDED' &&
        entry.aired_episode_count > 0 &&
        entrySnapshot.watched_episode_count < entrySnapshot.aired_episode_count &&
        entry.watched_episode_count >= entry.aired_episode_count
          ? { showId: entry.show.tmdb_id, title: entry.show.title, posterPath: entry.show.poster_path }
          : null;

      results[entryIndex] = entry;
      nextWatchlist[bucketKey] = { ...nextWatchlist[bucketKey], results };

      // Phase 56: the Watch History tab previously only ever refreshed on
      // mount / pull-to-refresh — marking (or unmarking) an episode watched
      // anywhere else in the app (Shows Hub row, episode screen, season
      // screen) left it stale until the user manually pulled to refresh.
      // Same optimistic-first convention as the watchlist update above.
      const history = optimisticWatched
        ? {
            ...state.history,
            count: state.history.count + 1,
            results: [
              {
                id: `optimistic-${episode.tmdb_id}`,
                episode: episodes[episodeIndex],
                show_id: entry.show.tmdb_id,
                show_title: entry.show.title,
                show_poster_path: entry.show.poster_path,
                watched_at: watchedAtIso,
              },
              ...state.history.results,
            ],
          }
        : {
            ...state.history,
            count: Math.max(0, state.history.count - (state.history.results.some((h) => h.episode.tmdb_id === episodeId) ? 1 : 0)),
            results: state.history.results.filter((h) => h.episode.tmdb_id !== episodeId),
          };

      return {
        watchlist: nextWatchlist,
        history,
        completedShow: justCompletedShow ?? state.completedShow,
        profile: state.profile
          ? {
              ...state.profile,
              total_time_watched: Math.max(0, state.profile.total_time_watched + runtimeDelta),
            }
          : state.profile,
      };
    });

    try {
      const response = await api.post<ToggleResponse>('/watch-state/toggle/', {
        episode_id: episodeId,
      });
      set((state) => {
        let nextProfile = state.profile;
        if (state.profile) {
          nextProfile = {
            ...state.profile,
            total_time_watched: response.data.total_time_watched,
            earned_badges: response.data.newly_earned_badges
              ? [...state.profile.earned_badges, ...response.data.newly_earned_badges]
              : state.profile.earned_badges,
          };
        }
        return {
          profile: nextProfile,
          unlockedBadges: response.data.newly_earned_badges?.length
            ? response.data.newly_earned_badges
            : state.unlockedBadges,
        };
      });
      get().syncWidgetData();
    } catch (error) {
      set({
        watchlist: previousWatchlist,
        profile: previousProfile,
        history: previousHistory,
        error: extractErrorMessage(error),
      });
    }
  },

  logInteraction: async (episodeId, payload) => {
    try {
      await api.post('/episode/interaction/', { episode_id: episodeId, ...payload });
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  clearError: () => set({ error: null }),

  fetchMovieWatchlist: async () => {
    set({ isLoadingMovies: true, error: null });
    try {
      const response = await api.get<MovieWatchlistBuckets>('/movies/watchlist/');
      set({ movieWatchlist: response.data, isLoadingMovies: false });
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingMovies: false });
    }
  },

  toggleMovieWatchState: async (movieId: number) => {
    const prev = get().movieWatchlist;
    const prevProfile = get().profile;

    // Find the movie entry in either bucket
    const inWatchNext = prev.watch_next.find((item) => item.movie.tmdb_id === movieId);
    const inWatched = prev.watched.find((item) => item.movie.tmdb_id === movieId);
    const entry = inWatchNext ?? inWatched;
    if (!entry) return false;

    const wasWatched = entry.movie.is_watched;
    const runtimeDelta = wasWatched ? -entry.movie.runtime_minutes : entry.movie.runtime_minutes;
    // Movies have no dedicated "last watched" timestamp field like
    // WatchlistEntry.last_watched_at — `updated_at` doubles as one, bumped
    // client-side here so the My Movies "Last Watched" sort (Phase 57)
    // reflects a mark-watched immediately instead of only after the next
    // fetchMovieWatchlist(). Unmarking leaves it alone, matching the shows
    // side's "unmark doesn't move it" convention.
    const watchedAtIso = new Date().toISOString();

    // Optimistic: move between buckets and flip is_watched
    set((state) => {
      const updatedEntry = {
        ...entry,
        updated_at: !wasWatched ? watchedAtIso : entry.updated_at,
        movie: { ...entry.movie, is_watched: !wasWatched },
      };
      const nextWatchNext = wasWatched
        ? [updatedEntry, ...state.movieWatchlist.watch_next]
        : state.movieWatchlist.watch_next.filter((i) => i.movie.tmdb_id !== movieId);
      const nextWatched = wasWatched
        ? state.movieWatchlist.watched.filter((i) => i.movie.tmdb_id !== movieId)
        : [updatedEntry, ...state.movieWatchlist.watched];

      return {
        movieWatchlist: { watch_next: nextWatchNext, watched: nextWatched },
        profile: state.profile
          ? {
              ...state.profile,
              total_time_watched: Math.max(0, state.profile.total_time_watched + runtimeDelta),
            }
          : state.profile,
      };
    });

    try {
      const response = await api.post<MovieToggleResponse>('/movies/watch-state/toggle/', {
        movie_id: movieId,
      });
      set((state) => {
        if (!state.profile) return {};
        return {
          profile: {
            ...state.profile,
            total_time_watched: response.data.total_time_watched,
            earned_badges: response.data.newly_earned_badges?.length
              ? [...state.profile.earned_badges, ...response.data.newly_earned_badges]
              : state.profile.earned_badges,
          },
          unlockedBadges: response.data.newly_earned_badges?.length
            ? response.data.newly_earned_badges
            : state.unlockedBadges,
        };
      });
      return true;
    } catch (error) {
      set({ movieWatchlist: prev, profile: prevProfile, error: extractErrorMessage(error) });
      return false;
    }
  },

  addMovieToWatchlist: async (movieId: number) => {
    try {
      const response = await api.post<MovieWatchlistItem>('/movies/add/', { movie_id: movieId });
      const item = response.data;
      set((state) => {
        const alreadyIn =
          state.movieWatchlist.watch_next.some((i) => i.movie.tmdb_id === movieId) ||
          state.movieWatchlist.watched.some((i) => i.movie.tmdb_id === movieId);
        if (alreadyIn) return {};
        return {
          movieWatchlist: {
            ...state.movieWatchlist,
            watch_next: [item, ...state.movieWatchlist.watch_next],
          },
        };
      });
      return true;
    } catch (error) {
      set({ error: extractErrorMessage(error) });
      return false;
    }
  },

  removeMovieFromWatchlist: async (movieId: number) => {
    const previousMovieWatchlist = get().movieWatchlist;

    set((state) => ({
      movieWatchlist: {
        watch_next: state.movieWatchlist.watch_next.filter((i) => i.movie.tmdb_id !== movieId),
        watched: state.movieWatchlist.watched.filter((i) => i.movie.tmdb_id !== movieId),
      },
    }));

    try {
      const response = await api.delete<MovieRemoveResponse>('/movies/watchlist/remove/', {
        data: { movie_id: movieId },
      });
      get().fetchProfile();
      return { movieId: response.data.movie_id, wasWatched: response.data.was_watched };
    } catch (error) {
      set({ movieWatchlist: previousMovieWatchlist, error: extractErrorMessage(error) });
      return null;
    }
  },

  undoRemoveMovie: async (snapshot: RemovedMovieSnapshot) => {
    const added = await get().addMovieToWatchlist(snapshot.movieId);
    if (!added) return;
    try {
      if (snapshot.wasWatched) {
        await get().toggleMovieWatchState(snapshot.movieId);
      }
    } finally {
      get().fetchMovieWatchlist();
      get().fetchProfile();
    }
  },

  addMovieRewatch: async (movieId: number) => {
    try {
      await api.post(`/rewatch/movies/${movieId}/`);
      await Promise.all([get().fetchMovieWatchlist(), get().fetchProfile()]);
      return true;
    } catch (error) {
      set({ error: extractErrorMessage(error) });
      return false;
    }
  },

  removeMovieRewatch: async (movieId: number) => {
    try {
      await api.delete(`/rewatch/movies/${movieId}/`);
      await Promise.all([get().fetchMovieWatchlist(), get().fetchProfile()]);
      return true;
    } catch (error) {
      set({ error: extractErrorMessage(error) });
      return false;
    }
  },

  addShowToWatchlist: async (showId: number) => {
    try {
      const response = await api.post<WatchlistEntry>('/watchlist/add/', { show_id: showId });
      let entry = response.data;

      // ShowAddView's own season-1 eager-cache is best-effort and swallows
      // TMDB failures silently (transient network blips happen — TMDB SSL
      // resets, timeouts). If it lost that race, entry.show.episodes is
      // empty, and buildRows() on the Shows Hub drops any watchlist entry
      // with zero cached episodes — the show would be added but invisible
      // in every filter pill. Retry once here via the season endpoint
      // (already used by the season screen) before giving up.
      if (entry.show.episodes.length === 0 && entry.show.total_seasons > 0) {
        try {
          await api.get(`/shows/${showId}/season/1/`);
          const refetched = await api.post<WatchlistEntry>('/watchlist/add/', { show_id: showId });
          entry = refetched.data;
        } catch {
          // Still no episode data — the entry is added as-is; opening the
          // show's season screen later will backfill it.
        }
      }

      set((state) => {
        const alreadyIn =
          state.watchlist.to_watch.results.some((e) => e.show.tmdb_id === showId) ||
          state.watchlist.up_to_date.results.some((e) => e.show.tmdb_id === showId) ||
          state.watchlist.archived.results.some((e) => e.show.tmdb_id === showId);
        if (alreadyIn) return {};
        return {
          watchlist: {
            ...state.watchlist,
            to_watch: {
              ...state.watchlist.to_watch,
              count: state.watchlist.to_watch.count + 1,
              results: [entry, ...state.watchlist.to_watch.results],
            },
          },
        };
      });
      // A freshly-added show belongs in the "Next Up" widget immediately —
      // without this it silently stayed missing until some other action
      // happened to trigger a fetchWatchlist()/toggle elsewhere.
      get().syncWidgetData();
      return true;
    } catch (error) {
      set({ error: extractErrorMessage(error) });
      return false;
    }
  },

  removeShowFromWatchlist: async (showId: number) => {
    const previousWatchlist = get().watchlist;
    const bucketKeys: (keyof WatchlistBuckets)[] = ['to_watch', 'up_to_date', 'archived'];

    // Optimistic removal — disappear from Shows Hub / Upcoming immediately
    // rather than waiting on the round trip. The widget and Profile counts
    // are resynced explicitly below once the delete is confirmed.
    set((state) => {
      const next = { ...state.watchlist };
      for (const key of bucketKeys) {
        const idx = next[key].results.findIndex((e) => e.show.tmdb_id === showId);
        if (idx !== -1) {
          next[key] = {
            ...next[key],
            count: Math.max(0, next[key].count - 1),
            results: next[key].results.filter((e) => e.show.tmdb_id !== showId),
          };
          break;
        }
      }
      return { watchlist: next };
    });

    try {
      const response = await api.delete<ShowRemoveResponse>('/watchlist/remove/', {
        data: { show_id: showId },
      });
      get().fetchProfile();
      get().syncWidgetData();
      const data = response.data;
      return {
        showId: data.show_id,
        watchedEpisodeIds: data.watched_episode_ids,
        wasFavorite: data.was_favorite,
        wasStatus: data.was_status,
        wasIgnoreCatchup: data.was_ignore_catchup,
      };
    } catch (error) {
      set({ watchlist: previousWatchlist, error: extractErrorMessage(error) });
      return null;
    }
  },

  undoRemoveShow: async (snapshot: RemovedShowSnapshot) => {
    const added = await get().addShowToWatchlist(snapshot.showId);
    if (!added) return;
    try {
      if (snapshot.wasFavorite) {
        await api.post('/watchlist/favorite/', { show_id: snapshot.showId });
      }
      if (snapshot.wasStatus === 'ARCHIVED') {
        await api.post('/watchlist/archive/', { show_id: snapshot.showId, archived: true });
      }
      if (snapshot.wasIgnoreCatchup) {
        await api.post('/watchlist/catchup-preference/', {
          show_id: snapshot.showId,
          ignore_catchup: true,
        });
      }
      // bulkToggleWatchState calls the real backend regardless of what's
      // locally cached (see its own comment) — this restores every watched
      // episode even if the freshly re-added entry only has season 1's
      // episodes cached client-side so far.
      if (snapshot.watchedEpisodeIds.length > 0) {
        await get().bulkToggleWatchState(snapshot.watchedEpisodeIds, true);
      }
    } finally {
      get().fetchWatchlist();
      get().fetchProfile();
    }
  },

  fetchShowRewatchDetail: async (showId: number) => {
    try {
      const response = await api.get<{ active_rewatch: ShowRewatchDetail | null }>(
        `/rewatch/shows/${showId}/`
      );
      set((state) => ({
        showRewatchDetail: { ...state.showRewatchDetail, [showId]: response.data.active_rewatch },
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  startShowRewatch: async (showId: number) => {
    try {
      await api.post(`/rewatch/shows/${showId}/start/`);
      await Promise.all([get().fetchShowRewatchDetail(showId), get().fetchWatchlist()]);
      return null;
    } catch (error) {
      const message = extractErrorMessage(error);
      set({ error: message });
      return message;
    }
  },

  cancelShowRewatch: async (showId: number) => {
    try {
      await api.delete(`/rewatch/shows/${showId}/`);
      set((state) => ({ showRewatchDetail: { ...state.showRewatchDetail, [showId]: null } }));
      await Promise.all([get().fetchWatchlist(), get().fetchProfile()]);
      return true;
    } catch (error) {
      set({ error: extractErrorMessage(error) });
      return false;
    }
  },

  toggleRewatchEpisode: async (episodeId: number, showId: number) => {
    try {
      await api.post(`/rewatch/episodes/${episodeId}/toggle/`);
      // The toggle response doesn't carry the full per-episode list back
      // (see RewatchEpisodeToggleView) — refetch the one show's detail
      // rather than hand-patching watched_episode_ids optimistically,
      // which would drift the moment a round completes (completed_at
      // changes what "the active round" even means server-side).
      await Promise.all([get().fetchShowRewatchDetail(showId), get().fetchWatchlist(), get().fetchProfile()]);
      return true;
    } catch (error) {
      set({ error: extractErrorMessage(error) });
      return false;
    }
  },

  setCatchupPreference: async (showId: number, ignoreCatchup: boolean) => {
    const previousWatchlist = get().watchlist;
    set((state) => {
      const bucketKeys: (keyof WatchlistBuckets)[] = ['to_watch', 'up_to_date', 'archived'];
      const nextWatchlist = { ...state.watchlist };
      for (const bucketKey of bucketKeys) {
        nextWatchlist[bucketKey] = {
          ...state.watchlist[bucketKey],
          results: state.watchlist[bucketKey].results.map((entry) =>
            entry.show.tmdb_id === showId ? { ...entry, ignore_catchup: ignoreCatchup } : entry
          ),
        };
      }
      return { watchlist: nextWatchlist };
    });
    try {
      await api.post('/watchlist/catchup-preference/', {
        show_id: showId,
        ignore_catchup: ignoreCatchup,
      });
    } catch (error) {
      set({ watchlist: previousWatchlist, error: extractErrorMessage(error) });
    }
  },

  bulkToggleWatchState: async (episodeIds: number[], watched: boolean) => {
    const previousWatchlist = get().watchlist;
    const previousProfile = get().profile;
    const previousHistory = get().history;

    // Optimistic update for all affected episodes
    set((state) => {
      const nextWatchlist: WatchlistBuckets = {
        to_watch: { ...state.watchlist.to_watch, results: [...state.watchlist.to_watch.results] },
        up_to_date: { ...state.watchlist.up_to_date, results: [...state.watchlist.up_to_date.results] },
        archived: { ...state.watchlist.archived, results: [...state.watchlist.archived.results] },
      };
      const idSet = new Set(episodeIds);
      let totalRuntimeDelta = 0;
      const watchedAtIso = new Date().toISOString();
      // Phase 56: mirror toggleWatchState's optimistic Watch History update
      // here too — Mark/Unmark Season Watched and the Catch-Up cascade both
      // go through this path, and hit the exact same desync bug.
      const newHistoryEntries: HistoryEntry[] = [];
      const unwatchedEpisodeIds = new Set<number>();
      // Phase 67: same series-finished celebration as toggleWatchState,
      // for the bulk path (Catch-Up cascade, Mark Season Watched). Both
      // current call sites are single-show, but episodeIds is generic
      // across the whole watchlist, so this loop could in principle touch
      // more than one show — first genuine completion found wins, since
      // only one celebration can show at a time anyway (completedShow is a
      // single value, not a queue).
      let bulkCompletedShow: CompletedShowInfo | null = null;

      for (const bucketKey of Object.keys(nextWatchlist) as (keyof WatchlistBuckets)[]) {
        nextWatchlist[bucketKey].results = nextWatchlist[bucketKey].results.map((entry) => {
          // Skip entries with none of the toggled episodes, returning the
          // exact same reference rather than rebuilding it — this used to
          // rebuild every entry in every bucket unconditionally (new
          // episodes array, new show object, new entry object) even when
          // none of its episodes were in idSet, so a single-show "Mark
          // Season Watched" (10ish episode ids) was allocating fresh
          // objects for the user's *entire* library on every call. With
          // ShowRow/ShowPosterCard now memoized, returning the same
          // reference here is what actually lets them skip re-rendering
          // every other show in the list.
          if (!entry.show.episodes.some((ep) => idSet.has(ep.tmdb_id))) return entry;

          const beforeWatchedCount = entry.watched_episode_count;
          let affected = false;
          const episodes = entry.show.episodes.map((ep) => {
            if (!idSet.has(ep.tmdb_id)) return ep;
            affected = true;
            const wasWatched = ep.is_watched;
            if (wasWatched === watched) return ep;
            totalRuntimeDelta += watched ? ep.runtime_minutes : -ep.runtime_minutes;
            const nextEp = { ...ep, is_watched: watched };
            if (watched) {
              newHistoryEntries.push({
                id: `optimistic-${ep.tmdb_id}`,
                episode: nextEp,
                show_id: entry.show.tmdb_id,
                show_title: entry.show.title,
                show_poster_path: entry.show.poster_path,
                watched_at: watchedAtIso,
              });
            } else {
              unwatchedEpisodeIds.add(ep.tmdb_id);
            }
            return nextEp;
          });
          const watchedCount = episodes.filter((ep) => ep.is_watched).length;
          const progress =
            entry.aired_episode_count > 0
              ? Math.round((watchedCount / entry.aired_episode_count) * 1000) / 10
              : 0;

          if (
            !bulkCompletedShow &&
            watched &&
            affected &&
            entry.show.status === 'ENDED' &&
            entry.aired_episode_count > 0 &&
            beforeWatchedCount < entry.aired_episode_count &&
            watchedCount >= entry.aired_episode_count
          ) {
            bulkCompletedShow = { showId: entry.show.tmdb_id, title: entry.show.title, posterPath: entry.show.poster_path };
          }

          return {
            ...entry,
            show: { ...entry.show, episodes },
            watched_episode_count: watchedCount,
            progress_percentage: progress,
            // Same recency-for-bucketing reason as toggleWatchState: marking
            // episodes watched (e.g. a Catch-Up cascade) means "watched now",
            // so the show belongs in WATCH NEXT immediately. Bumped only for
            // entries actually touched, and only in the watch direction — an
            // un-mark ("Unmark Season Watched") leaves last_watched_at alone.
            last_watched_at: affected && watched ? watchedAtIso : entry.last_watched_at,
          };
        });
      }

      const history = watched
        ? newHistoryEntries.length > 0
          ? {
              ...state.history,
              count: state.history.count + newHistoryEntries.length,
              results: [...newHistoryEntries, ...state.history.results],
            }
          : state.history
        : unwatchedEpisodeIds.size > 0
          ? {
              ...state.history,
              count: Math.max(
                0,
                state.history.count -
                  state.history.results.filter((h) => unwatchedEpisodeIds.has(h.episode.tmdb_id)).length
              ),
              results: state.history.results.filter((h) => !unwatchedEpisodeIds.has(h.episode.tmdb_id)),
            }
          : state.history;

      return {
        watchlist: nextWatchlist,
        history,
        completedShow: bulkCompletedShow ?? state.completedShow,
        profile: state.profile
          ? { ...state.profile, total_time_watched: Math.max(0, state.profile.total_time_watched + totalRuntimeDelta) }
          : state.profile,
      };
    });

    try {
      const response = await api.post<BulkToggleResponse>('/watch-state/bulk-toggle/', {
        episode_ids: episodeIds,
        watched,
      });
      set((state) => {
        if (!state.profile) return {};
        return {
          profile: {
            ...state.profile,
            total_time_watched: response.data.total_time_watched,
            earned_badges: response.data.newly_earned_badges?.length
              ? [...state.profile.earned_badges, ...response.data.newly_earned_badges]
              : state.profile.earned_badges,
          },
          unlockedBadges: response.data.newly_earned_badges?.length
            ? response.data.newly_earned_badges
            : state.unlockedBadges,
        };
      });
      // The optimistic update above marked every requested id watched —
      // if the server actually skipped some (unaired), that's now wrong in
      // the in-memory watchlist/history (episode is_watched, watched_episode_
      // count, progress_percentage, last_watched_at all diverge). Rather
      // than hand-reversing that per-episode transform, resync from the
      // server, which is already authoritative for total_time_watched above.
      if (response.data.skipped_unaired_ids?.length) {
        set({
          error: `${response.data.skipped_unaired_ids.length} episode(s) haven't aired yet and were not marked watched.`,
        });
        get().fetchWatchlist();
        if (watched) get().fetchHistory();
      }
      get().syncWidgetData();
    } catch (error) {
      set({
        watchlist: previousWatchlist,
        profile: previousProfile,
        history: previousHistory,
        error: extractErrorMessage(error),
      });
    }
  },

  // ── Analytics fetch methods ──────────────────────────────────────────

  fetchDashboard: async () => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<AnalyticsDashboard>('/analytics/dashboard/');
      set({ dashboard: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchStatistics: async () => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<AnalyticsStatistics>('/analytics/statistics/');
      set({ statistics: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchAchievements: async () => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<AchievementItem[]>('/analytics/achievements/');
      set({ achievements: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchYearReview: async (year?: number) => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const params = year ? { year } : {};
      const res = await api.get<YearReview>('/analytics/year-review/', { params });
      set({ yearReview: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchMonthlyRecap: async (year?: number) => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const params = year ? { year } : {};
      const res = await api.get<MonthlySummaryItem[]>('/analytics/monthly-summary/', { params });
      set({ monthlyRecap: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchHeatmap: async () => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<HeatmapDay[]>('/analytics/heatmap/');
      set({ heatmap: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchHeatmapAll: async () => {
    set({ isLoadingHeatmapAll: true, analyticsError: null });
    try {
      const res = await api.get<{ years: HeatmapYear[] }>('/analytics/heatmap/', {
        params: { range: 'all' },
      });
      set({ heatmapAll: res.data.years, isLoadingHeatmapAll: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingHeatmapAll: false });
    }
  },

  fetchMovieAnalytics: async () => {
    set({ isLoadingMovieAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<MovieAnalytics>('/analytics/movies/');
      set({ movieAnalytics: res.data, isLoadingMovieAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingMovieAnalytics: false });
    }
  },

  fetchStreak: async () => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<StreakData>('/analytics/streak/');
      set({ streak: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchGenres: async () => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<GenreStat[]>('/analytics/genres/');
      set({ genres: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  fetchCompletion: async () => {
    set({ isLoadingAnalytics: true, analyticsError: null });
    try {
      const res = await api.get<CompletionData>('/analytics/completion/');
      set({ completion: res.data, isLoadingAnalytics: false });
    } catch (error) {
      set({ analyticsError: extractErrorMessage(error), isLoadingAnalytics: false });
    }
  },

  syncWidgetData: async () => {
    try {
      const { to_watch, up_to_date } = get().watchlist;
      // Upcoming episodes belong to caught-up shows just as much as behind
      // ones — a show sitting in UP TO DATE is precisely the one whose next
      // episode the user is waiting on, and excluding that bucket is why the
      // widget could look empty for an otherwise-current watchlist.
      const entries = [...to_watch.results, ...up_to_date.results];

      // Payload shape and every rule behind it (next-episode pick, 45-day
      // window, caps) live in lib/widgetPayload.ts, shared with the
      // Android headless task handler so a widget redraw with the app
      // closed builds exactly the same thing. Note the payload carries no
      // precomputed durations — countdowns and air times are resolved by
      // the widgets themselves at render, so they stay correct however
      // long ago this sync ran.
      const widgetData = buildWidgetPayload(to_watch.results, entries);

      if (Platform.OS === 'android') {
        if (SharedPreferences) {
          SharedPreferences.setItem('widgetData', JSON.stringify(widgetData));
        }
        // Proactively redraw rather than waiting for Android's own
        // updatePeriodMillis interval — no-ops safely (empty widget list)
        // if the native module isn't linked yet (Expo Go / dev-client).
        requestWidgetUpdate({
          widgetName: 'WatchlistWidget',
          renderWidget: () => React.createElement(AndroidWatchlistWidget, { data: widgetData }),
          widgetNotFound: () => {},
        }).catch(() => {});
        requestWidgetUpdate({
          widgetName: 'UpcomingWidget',
          renderWidget: () => React.createElement(AndroidUpcomingWidget, { data: widgetData }),
          widgetNotFound: () => {},
        }).catch(() => {});
      } else if (Platform.OS === 'ios') {
        IOSWidgets.WatchlistWidget?.updateSnapshot({ watchlist: widgetData.watchlist });
        IOSWidgets.UpcomingWidget?.updateSnapshot({ upcoming: widgetData.upcoming });
      }
    } catch (error) {
      console.warn('Failed to sync widget data', error);
    }
  },

  clearWidgetData: async () => {
    try {
      // loggedOut distinguishes "signed out" from a genuinely empty
      // watchlist — both used to write the identical {watchlist: [],
      // upcoming: []} shape, so the widgets showed "Your watchlist is
      // empty" after logout instead of prompting the user to log back in.
      const emptyData = {
        watchlist: [],
        upcoming: [],
        loggedOut: true,
        syncedAt: new Date().toISOString(),
      };
      if (Platform.OS === 'android') {
        if (SharedPreferences) {
          SharedPreferences.setItem('widgetData', JSON.stringify(emptyData));
        }
        requestWidgetUpdate({
          widgetName: 'WatchlistWidget',
          renderWidget: () => React.createElement(AndroidWatchlistWidget, { data: emptyData }),
          widgetNotFound: () => {},
        }).catch(() => {});
        requestWidgetUpdate({
          widgetName: 'UpcomingWidget',
          renderWidget: () => React.createElement(AndroidUpcomingWidget, { data: emptyData }),
          widgetNotFound: () => {},
        }).catch(() => {});
      } else if (Platform.OS === 'ios') {
        IOSWidgets.WatchlistWidget?.updateSnapshot({ watchlist: [], loggedOut: true });
        IOSWidgets.UpcomingWidget?.updateSnapshot({ upcoming: [], loggedOut: true });
      }
    } catch (error) {
      console.warn('Failed to clear widget data', error);
    }
  },
    }),
    {
      name: 'watchtracker-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // v0 -> v1: preferredLayout/toggleLayout (one global list/grid choice)
      // replaced by defaultLayout + per-scope layoutOverrides (Phase 75.5) —
      // seed the new default from whatever was already persisted so an
      // existing user's choice isn't silently reset to 'list'.
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>;
        if (version < 1) {
          const { preferredLayout, ...rest } = state;
          return {
            ...rest,
            defaultLayout: preferredLayout === 'grid' ? 'grid' : 'list',
            layoutOverrides: {},
          };
        }
        return state;
      },
      partialize: (state) => ({
        watchlist: state.watchlist,
        // Without this, movieWatchlist never survived an app restart (unlike
        // watchlist, right above) — a cold launch always started it back at
        // the empty default until whatever screen first fetches it (Movies
        // tab / profile/movies) happened to mount, which meant Profile's "My
        // Movies" badge could read 0 immediately next to a watch-time stat
        // that already includes those same movies' minutes.
        movieWatchlist: state.movieWatchlist,
        profile: state.profile,
        defaultLayout: state.defaultLayout,
        layoutOverrides: state.layoutOverrides,
        selectedLanguage: state.selectedLanguage,
        dashboard: state.dashboard,
        statistics: state.statistics,
        genres: state.genres,
        heatmap: state.heatmap,
        streak: state.streak,
        yearReview: state.yearReview,
        monthlyRecap: state.monthlyRecap,
        achievements: state.achievements,
        completion: state.completion,
      }),
    }
  )
);

/** The effective layout for one screen — its own override if it's set one,
 *  else the app-wide default (Settings > Appearance). Two separate scoped
 *  selectors rather than one combined one, so a screen only re-renders when
 *  the piece of state it actually depends on changes. */
export function useLayoutFor(scope: LayoutScope): LayoutMode {
  const defaultLayout = useWatchStore((s) => s.defaultLayout);
  const override = useWatchStore((s) => s.layoutOverrides[scope]);
  return override ?? defaultLayout;
}