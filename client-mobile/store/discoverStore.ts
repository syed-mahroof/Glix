// client-mobile/store/discoverStore.ts
// Non-persisted, in-memory Zustand store for the Discover Hub.
// Kept separate from watchStore.ts to avoid polluting the persisted slice.

import { create } from 'zustand';
import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DiscoverMediaItem {
  tmdb_id: number;
  media_type: 'tv' | 'movie';
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  release_date: string | null;
}

export interface FeedSection {
  id: string;
  title: string;
  items: DiscoverMediaItem[];
}

export interface DiscoverFeedResponse {
  type: 'tv' | 'movie';
  hero: DiscoverMediaItem[];
  sections: FeedSection[];
}

export interface UniversalSearchResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: DiscoverMediaItem[];
}

export type ActiveSegment = 'tv' | 'movie';
export type SortOrder = 'trending' | 'popular' | 'top_rated' | 'critically_acclaimed';

export interface GenreCover {
  id: number;
  backdrop_path: string | null;
  poster_path: string | null;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

interface DiscoverState {
  // UI state
  activeSegment: ActiveSegment;
  searchQuery: string;
  selectedGenreId: number | null;
  sortOrder: SortOrder;
  /** Distinct store/state from watchStore's My Shows/My Movies
   *  `selectedLanguage` (Phase H) — Discover browses live TMDB results, not
   *  the user's own cached watchlist, so it needs its own selection even
   *  though it reuses the same `LanguageFilterModal` component/language
   *  names for a consistent picker UI. */
  selectedLanguage: string | null;
  /** Same heuristic as lib/anime.ts / My Shows' Anime filter (Phase H) —
   *  expressed server-side as Animation genre + Japanese language, see
   *  DiscoverFilterView. Not a second definition of "anime". */
  animeOnly: boolean;
  filterSheetVisible: boolean;

  // Feed data
  feedData: Record<ActiveSegment, DiscoverFeedResponse | null>;
  isLoadingFeed: boolean;
  feedError: string | null;

  // Search data
  searchResults: DiscoverMediaItem[];
  searchPage: number;
  searchTotalPages: number;
  isSearching: boolean;
  isLoadingMoreSearch: boolean;
  searchError: string | null;

  // Filtered browse data (Filter & Sort sheet — genre/sort/language/anime,
  // distinct from the curated feed sections and from universal search)
  filteredResults: DiscoverMediaItem[];
  filteredPage: number;
  filteredTotalPages: number;
  isLoadingFiltered: boolean;
  isLoadingMoreFiltered: boolean;
  filteredError: string | null;

  // Genre Grid cover images (real TMDB backdrops, one per genre — cached
  // per segment so switching tv/movie and back doesn't re-fetch)
  genreCovers: Record<ActiveSegment, Record<number, GenreCover>>;
  isLoadingGenreCovers: boolean;

  // Actions
  setActiveSegment: (segment: ActiveSegment) => void;
  setSearchQuery: (query: string) => void;
  setSelectedGenreId: (genreId: number | null) => void;
  setSortOrder: (order: SortOrder) => void;
  setSelectedLanguage: (language: string | null) => void;
  setAnimeOnly: (animeOnly: boolean) => void;
  toggleFilterSheet: () => void;
  closeFilterSheet: () => void;
  fetchFeed: (segment: ActiveSegment) => Promise<void>;
  runSearch: (query: string) => Promise<void>;
  loadMoreSearchResults: () => Promise<void>;
  clearSearch: () => void;
  fetchFilteredResults: () => Promise<void>;
  loadMoreFilteredResults: () => Promise<void>;
  resetFilters: () => void;
  isFilterActive: () => boolean;
  fetchGenreCovers: (segment: ActiveSegment) => Promise<void>;
}

export const useDiscoverStore = create<DiscoverState>((set, get) => ({
  // Initial UI state
  activeSegment: 'tv',
  searchQuery: '',
  selectedGenreId: null,
  sortOrder: 'trending',
  selectedLanguage: null,
  animeOnly: false,
  filterSheetVisible: false,

  // Initial data state
  feedData: { tv: null, movie: null },
  isLoadingFeed: false,
  feedError: null,

  searchResults: [],
  searchPage: 1,
  searchTotalPages: 1,
  isSearching: false,
  isLoadingMoreSearch: false,
  searchError: null,

  filteredResults: [],
  filteredPage: 1,
  filteredTotalPages: 1,
  isLoadingFiltered: false,
  isLoadingMoreFiltered: false,
  filteredError: null,

  genreCovers: { tv: {}, movie: {} },
  isLoadingGenreCovers: false,

  // ── Actions ──────────────────────────────────────────────────────────────────

  isFilterActive: () => {
    const { selectedGenreId, sortOrder, selectedLanguage, animeOnly } = get();
    return selectedGenreId !== null || sortOrder !== 'trending' || selectedLanguage !== null || animeOnly;
  },

  setActiveSegment: (segment) => {
    set({ activeSegment: segment });
    if (get().isFilterActive()) {
      get().fetchFilteredResults();
    } else if (!get().feedData[segment]) {
      get().fetchFeed(segment);
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedGenreId: (genreId) => {
    set({ selectedGenreId: genreId });
    if (get().isFilterActive()) {
      get().fetchFilteredResults();
    } else {
      // Back to fully default (no genre, default sort) — nothing to
      // fetch, and clear stale results so a re-toggle doesn't briefly
      // flash the previous filtered list before the curated feed shows.
      set({ filteredResults: [], filteredError: null });
    }
  },

  setSortOrder: (order) => {
    set({ sortOrder: order });
    if (get().isFilterActive()) {
      get().fetchFilteredResults();
    } else {
      set({ filteredResults: [], filteredError: null });
    }
  },

  setSelectedLanguage: (language) => {
    // Mirrors the anime override the backend itself applies (see
    // DiscoverFilterView) — surfacing it here too means the sheet's own UI
    // reflects the resolved state immediately instead of the user picking
    // a language that silently gets overridden server-side with no
    // visible feedback.
    set({ selectedLanguage: language, animeOnly: language !== null ? false : get().animeOnly });
    if (get().isFilterActive()) {
      get().fetchFilteredResults();
    } else {
      set({ filteredResults: [], filteredError: null });
    }
  },

  setAnimeOnly: (animeOnly) => {
    set({ animeOnly, selectedLanguage: animeOnly ? null : get().selectedLanguage });
    if (get().isFilterActive()) {
      get().fetchFilteredResults();
    } else {
      set({ filteredResults: [], filteredError: null });
    }
  },

  toggleFilterSheet: () =>
    set((state) => ({ filterSheetVisible: !state.filterSheetVisible })),

  closeFilterSheet: () => set({ filterSheetVisible: false }),

  fetchFeed: async (segment) => {
    // Skip if already cached
    if (get().feedData[segment]) return;

    set({ isLoadingFeed: true, feedError: null });
    try {
      const response = await api.get<DiscoverFeedResponse>(
        `/discover/feed/?type=${segment}`
      );
      set((state) => ({
        feedData: { ...state.feedData, [segment]: response.data },
        isLoadingFeed: false,
      }));
    } catch (err) {
      set({ feedError: extractErrorMessage(err), isLoadingFeed: false });
    }
  },

  runSearch: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false, searchError: null, searchPage: 1, searchTotalPages: 1 });
      return;
    }
    set({ isSearching: true, searchError: null });
    try {
      const response = await api.get<UniversalSearchResponse>(
        `/search/universal/?query=${encodeURIComponent(query)}`
      );
      set({
        searchResults: response.data.results,
        searchPage: response.data.page,
        searchTotalPages: response.data.total_pages,
        isSearching: false,
      });
    } catch (err) {
      set({ searchError: extractErrorMessage(err), isSearching: false, searchResults: [] });
    }
  },

  loadMoreSearchResults: async () => {
    const { searchQuery, searchPage, searchTotalPages, isSearching, isLoadingMoreSearch } = get();
    if (isSearching || isLoadingMoreSearch || !searchQuery.trim() || searchPage >= searchTotalPages) return;
    set({ isLoadingMoreSearch: true });
    try {
      const nextPage = searchPage + 1;
      const response = await api.get<UniversalSearchResponse>(
        `/search/universal/?query=${encodeURIComponent(searchQuery)}&page=${nextPage}`
      );
      set((state) => ({
        searchResults: [...state.searchResults, ...response.data.results],
        searchPage: response.data.page,
        searchTotalPages: response.data.total_pages,
        isLoadingMoreSearch: false,
      }));
    } catch {
      // Best-effort — a failed "load more" tail request just means the
      // user can trigger it again by scrolling; not worth a full error
      // state for results that are already on screen.
      set({ isLoadingMoreSearch: false });
    }
  },

  clearSearch: () =>
    set({
      searchQuery: '',
      searchResults: [],
      isSearching: false,
      searchError: null,
      searchPage: 1,
      searchTotalPages: 1,
    }),

  fetchFilteredResults: async () => {
    const { activeSegment, selectedGenreId, sortOrder, selectedLanguage, animeOnly } = get();
    set({ isLoadingFiltered: true, filteredError: null });
    try {
      const params: Record<string, string> = { type: activeSegment, sort: sortOrder };
      if (selectedGenreId !== null) {
        params.genre = String(selectedGenreId);
      }
      if (selectedLanguage) {
        params.language = selectedLanguage;
      }
      if (animeOnly) {
        params.anime = 'true';
      }
      const response = await api.get<UniversalSearchResponse>('/discover/filter/', { params });
      set({
        filteredResults: response.data.results,
        filteredPage: response.data.page,
        filteredTotalPages: response.data.total_pages,
        isLoadingFiltered: false,
      });
    } catch (err) {
      set({ filteredError: extractErrorMessage(err), isLoadingFiltered: false, filteredResults: [] });
    }
  },

  loadMoreFilteredResults: async () => {
    const {
      activeSegment,
      selectedGenreId,
      sortOrder,
      selectedLanguage,
      animeOnly,
      filteredPage,
      filteredTotalPages,
      isLoadingFiltered,
      isLoadingMoreFiltered,
    } = get();
    if (isLoadingFiltered || isLoadingMoreFiltered || filteredPage >= filteredTotalPages) return;
    set({ isLoadingMoreFiltered: true });
    try {
      const params: Record<string, string> = {
        type: activeSegment,
        sort: sortOrder,
        page: String(filteredPage + 1),
      };
      if (selectedGenreId !== null) params.genre = String(selectedGenreId);
      if (selectedLanguage) params.language = selectedLanguage;
      if (animeOnly) params.anime = 'true';
      const response = await api.get<UniversalSearchResponse>('/discover/filter/', { params });
      set((state) => ({
        filteredResults: [...state.filteredResults, ...response.data.results],
        filteredPage: response.data.page,
        filteredTotalPages: response.data.total_pages,
        isLoadingMoreFiltered: false,
      }));
    } catch {
      set({ isLoadingMoreFiltered: false });
    }
  },

  resetFilters: () => {
    set({
      selectedGenreId: null,
      sortOrder: 'trending',
      selectedLanguage: null,
      animeOnly: false,
      filteredResults: [],
      filteredError: null,
    });
  },

  fetchGenreCovers: async (segment) => {
    // Skip if already cached for this segment
    if (Object.keys(get().genreCovers[segment]).length > 0) return;

    set({ isLoadingGenreCovers: true });
    try {
      const response = await api.get<GenreCover[]>('/discover/genres/', {
        params: { type: segment },
      });
      const bySegmentId: Record<number, GenreCover> = {};
      for (const cover of response.data) {
        bySegmentId[cover.id] = cover;
      }
      set((state) => ({
        genreCovers: { ...state.genreCovers, [segment]: bySegmentId },
        isLoadingGenreCovers: false,
      }));
    } catch {
      // Non-critical — GenreGrid falls back to a solid color card per genre.
      set({ isLoadingGenreCovers: false });
    }
  },
}));
