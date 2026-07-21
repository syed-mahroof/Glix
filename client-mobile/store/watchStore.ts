// client-mobile/store/watchStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { buildUpcomingItems, pickNextEpisode } from '../lib/upcoming';
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

export interface Episode {
  tmdb_id: number;
  show: number;
  season_number: number;
  episode_number: number;
  title: string;
  overview: string;
  air_date: string | null;
  runtime_minutes: number;
  still_path: string | null;
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
  next_episode_season_number: number | null;
  next_episode_number: number | null;
  next_episode_name: string | null;
  episodes: Episode[];
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
  total_time_watched: number;
  watched_days: number;
  watched_hours: number;
  watched_minutes: number;
  earned_badges: string[];
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
  episodes_watched: number;
  episodes_aired: number;
  shows_completed: number;
  shows_total: number;
}

interface AnalyticsSlice {
  dashboard: AnalyticsDashboard | null;
  statistics: AnalyticsStatistics | null;
  genres: GenreStat[];
  heatmap: HeatmapDay[];
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
  error: string | null;

  /** List vs. large poster grid — shared across every primary media list
   *  (Shows Hub, Movies Hub, Profile > My Shows/My Movies). Persisted so the
   *  choice sticks across app restarts. */
  preferredLayout: 'list' | 'grid';
  toggleLayout: () => void;

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

  // Movie actions
  fetchMovieWatchlist: () => Promise<void>;
  toggleMovieWatchState: (movieId: number) => Promise<void>;
  addMovieToWatchlist: (movieId: number) => Promise<boolean>;

  // Analytics methods
  fetchDashboard: () => Promise<void>;
  fetchStatistics: () => Promise<void>;
  fetchAchievements: () => Promise<void>;
  fetchYearReview: (year?: number) => Promise<void>;
  fetchMonthlyRecap: (year?: number) => Promise<void>;
  fetchHeatmap: () => Promise<void>;
  fetchStreak: () => Promise<void>;
  fetchGenres: () => Promise<void>;
  fetchCompletion: () => Promise<void>;
  clearUnlockedBadges: () => void;
  popUnlockedBadge: () => void;
  syncWidgetData: () => Promise<void>;
  clearWidgetData: () => Promise<void>;
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
      history: EMPTY_HISTORY_PAGE,
  profile: null,
  isLoadingWatchlist: false,
  isLoadingMovies: false,
  isLoadingHistory: false,
  isLoadingProfile: false,
  error: null,

  preferredLayout: 'list',
  toggleLayout: () =>
    set((state) => ({ preferredLayout: state.preferredLayout === 'list' ? 'grid' : 'list' })),

  selectedLanguage: null,
  setLanguageFilter: (language) => set({ selectedLanguage: language }),

  // ── Analytics state ──────────────────────────────────────────────────
  dashboard: null,
  statistics: null,
  genres: [],
  heatmap: [],
  streak: null,
  yearReview: null,
  monthlyRecap: [],
  achievements: [],
  completion: null,
  isLoadingAnalytics: false,
  analyticsError: null,
  unlockedBadges: [],

  clearUnlockedBadges: () => set({ unlockedBadges: [] }),
  popUnlockedBadge: () => set((state) => ({ unlockedBadges: state.unlockedBadges.slice(1) })),

  fetchWatchlist: async () => {
    set({ isLoadingWatchlist: true, error: null });
    try {
      const response = await api.get<WatchlistBuckets>('/watchlist/');
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

  toggleWatchState: async (episodeId: number) => {
    const location = findEntryAndEpisode(get().watchlist, episodeId);
    if (!location) {
      set({ error: `Episode ${episodeId} not found in current watchlist state.` });
      return;
    }

    const { bucketKey, entryIndex, episodeIndex } = location;
    const previousWatchlist = get().watchlist;
    const previousProfile = get().profile;
    const episode = previousWatchlist[bucketKey].results[entryIndex].show.episodes[episodeIndex];
    const optimisticWatched = !episode.is_watched;
    const runtimeDelta = optimisticWatched ? episode.runtime_minutes : -episode.runtime_minutes;

    set((state) => {
      const nextWatchlist: WatchlistBuckets = {
        to_watch: { ...state.watchlist.to_watch, results: [...state.watchlist.to_watch.results] },
        up_to_date: {
          ...state.watchlist.up_to_date,
          results: [...state.watchlist.up_to_date.results],
        },
        archived: { ...state.watchlist.archived, results: [...state.watchlist.archived.results] },
      };
      const results = nextWatchlist[bucketKey].results;
      const entry = { ...results[entryIndex] };
      const episodes = [...entry.show.episodes];
      episodes[episodeIndex] = { ...episodes[episodeIndex], is_watched: optimisticWatched };
      entry.show = { ...entry.show, episodes };
      entry.watched_episode_count = entry.watched_episode_count + (optimisticWatched ? 1 : -1);
      entry.progress_percentage =
        entry.aired_episode_count > 0
          ? Math.round((entry.watched_episode_count / entry.aired_episode_count) * 1000) / 10
          : 0;
      results[entryIndex] = entry;
      nextWatchlist[bucketKey] = { ...nextWatchlist[bucketKey], results };

      return {
        watchlist: nextWatchlist,
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
    if (!entry) return;

    const wasWatched = entry.movie.is_watched;
    const runtimeDelta = wasWatched ? -entry.movie.runtime_minutes : entry.movie.runtime_minutes;

    // Optimistic: move between buckets and flip is_watched
    set((state) => {
      const updatedEntry = {
        ...entry,
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
    } catch (error) {
      set({ movieWatchlist: prev, profile: prevProfile, error: extractErrorMessage(error) });
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

    // Optimistic update for all affected episodes
    set((state) => {
      const nextWatchlist: WatchlistBuckets = {
        to_watch: { ...state.watchlist.to_watch, results: [...state.watchlist.to_watch.results] },
        up_to_date: { ...state.watchlist.up_to_date, results: [...state.watchlist.up_to_date.results] },
        archived: { ...state.watchlist.archived, results: [...state.watchlist.archived.results] },
      };
      const idSet = new Set(episodeIds);
      let totalRuntimeDelta = 0;

      for (const bucketKey of Object.keys(nextWatchlist) as (keyof WatchlistBuckets)[]) {
        nextWatchlist[bucketKey].results = nextWatchlist[bucketKey].results.map((entry) => {
          const episodes = entry.show.episodes.map((ep) => {
            if (!idSet.has(ep.tmdb_id)) return ep;
            const wasWatched = ep.is_watched;
            if (wasWatched === watched) return ep;
            totalRuntimeDelta += watched ? ep.runtime_minutes : -ep.runtime_minutes;
            return { ...ep, is_watched: watched };
          });
          const watchedCount = episodes.filter((ep) => ep.is_watched).length;
          const progress =
            entry.aired_episode_count > 0
              ? Math.round((watchedCount / entry.aired_episode_count) * 1000) / 10
              : 0;
          return {
            ...entry,
            show: { ...entry.show, episodes },
            watched_episode_count: watchedCount,
            progress_percentage: progress,
          };
        });
      }

      return {
        watchlist: nextWatchlist,
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
      get().syncWidgetData();
    } catch (error) {
      set({ watchlist: previousWatchlist, profile: previousProfile, error: extractErrorMessage(error) });
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
      const entries = get().watchlist.to_watch.results;

      // "Next up" per show — same chronological rule the Shows Hub row uses
      // (earliest aired-unwatched, else nearest future episode), not just
      // "first unwatched in array order."
      const toWatch = entries.slice(0, 5).map((entry) => {
        const nextEp = pickNextEpisode(entry);
        return {
          id: entry.show.tmdb_id,
          title: entry.show.title,
          poster_path: entry.show.poster_path,
          next_episode: nextEp ? `S${nextEp.season_number} E${nextEp.episode_number}` : 'Up to date',
        };
      });

      // "Airing soon" is genuinely upcoming (unaired, future, unwatched)
      // episodes across the whole to-watch bucket — reuses the same builder
      // the Upcoming tab/calendar already trust, sorted soonest-first.
      const upcoming = buildUpcomingItems(entries)
        .slice(0, 5)
        .map((item) => ({
          id: item.tmdbShowId,
          title: item.showTitle,
          poster_path: item.posterPath,
          next_episode: `S${item.seasonNumber} E${item.episodeNumber}`,
          air_date: item.airDate,
        }));

      const widgetData = { watchlist: toWatch, upcoming };

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
      const emptyData = { watchlist: [], upcoming: [] };
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
        IOSWidgets.WatchlistWidget?.updateSnapshot({ watchlist: [] });
        IOSWidgets.UpcomingWidget?.updateSnapshot({ upcoming: [] });
      }
    } catch (error) {
      console.warn('Failed to clear widget data', error);
    }
  },
    }),
    {
      name: 'watchtracker-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        watchlist: state.watchlist,
        profile: state.profile,
        preferredLayout: state.preferredLayout,
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