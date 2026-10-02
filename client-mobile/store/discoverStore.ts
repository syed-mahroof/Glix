// client-mobile/store/discoverStore.ts
// Mostly in-memory Zustand store for the Discover Hub — kept separate from
// watchStore.ts to avoid polluting that persisted slice.
//
// Phase 83 (C13) stale-while-revalidate: the curated feed/For You/genre
// covers are now persisted (debounced, same storage as watchStore) so a
// cold start paints the last-seen Discover feed immediately instead of a
// bare spinner, then silently revalidates once in the background. Search
// and filtered-browse results stay unpersisted on purpose — they're
// query-specific snapshots, not something a returning visit should paint
// stale content for.

import axios from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';
import { createDebouncedStorage, markStorageHydrated } from '../lib/persistStorage';
import { MOVIE_GENRES, TV_GENRES } from '../lib/genres';
import { extractErrorMessage } from '../lib/errors';

// Named so `onRehydrateStorage` below can pass the exact same instance
// handed to `storage:` into markStorageHydrated() — see watchStore.ts's
// identical note for why this deliberately has NO explicit type argument.
const discoverStorage = createDebouncedStorage();

// Bug fix (2026-08-21, "empty gaps in the filtered Discover grid"): TMDB's
// popularity-ordered /discover pagination legitimately repeats a title
// across adjacent pages (a popularity tie moving pages as OTHER items shift
// around it). Appending a "load more" page unconditionally could put the
// same tmdb_id in the results array twice, at two different indices —
// FlashList's own `keyExtractor` (`${media_type}-${tmdb_id}`) then produces
// a duplicate key, which corrupts the recycler's cell↔key mapping and shows
// up as the same grid-hole/misalignment symptom as the height-uniformity bug
// this same fix batch addressed in SearchResultCard. Shared by both
// loadMoreSearchResults and loadMoreFilteredResults below rather than
// duplicated, since it's the exact same append operation for two different
// pieces of state.
function dedupeAppend(existing: DiscoverMediaItem[], incoming: DiscoverMediaItem[]): DiscoverMediaItem[] {
  const seen = new Set(existing.map((item) => `${item.media_type}-${item.tmdb_id}`));
  const fresh = incoming.filter((item) => {
    const key = `${item.media_type}-${item.tmdb_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...existing, ...fresh];
}

// In-flight request trackers for runSearch/fetchFilteredResults — plain
// module-scope refs, not store state, since nothing needs to re-render on
// their own account. Neither guard here checked *completed* state (the
// only kind Zustand's own `set` naturally lets you gate on), so fast
// typing/toggling fired overlapping requests with no relationship to each
// other; whichever happened to resolve last "won" regardless of which
// query/filter it was actually for. Aborting the previous one before
// starting the next fixes both the wasted network calls and the race.
let searchAbortController: AbortController | null = null;
let filteredAbortController: AbortController | null = null;
// Phase 83 perf: fetchFeed/fetchForYou/fetchGenreCovers/loadMore* had none
// of this — a fast segment toggle (tv/movie/tv) fired a new request on top
// of whatever the previous toggle was still waiting on, same race
// runSearch/fetchFilteredResults were already fixed for above.
let feedAbortController: AbortController | null = null;
let forYouAbortController: AbortController | null = null;
let genreCoversAbortController: AbortController | null = null;
let loadMoreSearchAbortController: AbortController | null = null;
let loadMoreFilteredAbortController: AbortController | null = null;
let providersAbortController: AbortController | null = null;
let releasesAbortController: AbortController | null = null;

export type Monetization = 'flatrate|free|ads' | 'flatrate' | 'free|ads' | 'rent|buy' | 'flatrate|free|ads|rent|buy';
export interface WatchProvider { provider_id: number; provider_name: string; logo_path: string | null }
export interface WatchRegion { code: string; name: string }
export interface DiscoverFilters {
  selectedGenreId: number | null;
  sortOrder: SortOrder;
  selectedLanguage: string | null;
  animeOnly: boolean;
  selectedProviderIds: number[];
  monetization: Monetization;
}
export function hasDiscoverFilters(state: DiscoverFilters): boolean {
  return state.selectedGenreId !== null || state.sortOrder !== 'trending' || state.selectedLanguage !== null || state.animeOnly || state.selectedProviderIds.length > 0 || state.monetization !== 'flatrate|free|ads';
}
function filterParams(state: DiscoverState, page = 1): Record<string, string> {
  const params: Record<string, string> = { type: state.activeSegment, sort: state.sortOrder, page: String(page) };
  if (state.selectedGenreId !== null) params.genre = String(state.selectedGenreId);
  if (state.selectedLanguage) params.language = state.selectedLanguage;
  if (state.animeOnly) params.anime = 'true';
  if (state.selectedProviderIds.length || state.monetization !== 'flatrate|free|ads') {
    params.providers = state.selectedProviderIds.join(',');
    params.region = state.watchRegion;
    params.monetization = state.monetization;
  }
  return params;
}

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
  subtitle?: string;
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

export interface ForYouItem extends DiscoverMediaItem {
  /** Human-readable "Because you watched X" string from the backend's
   *  cross-library recommendation merge — see recommendations_views.py. */
  reason: string;
}

// ─── Store ─────────────────────────────────────────────────────────────────────

interface DiscoverState extends DiscoverFilters {
  watchRegion: string;
  providerOptions: WatchProvider[];
  availableRegions: WatchRegion[];
  providerOptionsKey: string | null;
  isLoadingProviders: boolean;
  providersError: string | null;
  releases: Record<ActiveSegment, FeedSection | null>;
  releasesKey: string | null;
  isLoadingReleases: boolean;
  releasesError: string | null;
  applyFilters: (filters: Partial<DiscoverFilters>) => void;
  setWatchRegion: (region: string) => void;
  fetchProviders: (segment: ActiveSegment) => Promise<void>;
  fetchReleases: (segment: ActiveSegment, force?: boolean) => Promise<void>;
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
  /** When each segment's feedData was last fetched live — persisted
   *  alongside feedData so a returning session can tell "this is a
   *  same-session-fresh feed" from "this is last week's snapshot,
   *  painted immediately while a revalidation is in flight" (C13). Not
   *  set on rehydration, only on an actual successful fetchFeed(). */
  feedFetchedAt: Record<ActiveSegment, number | null>;
  /** Session-scoped "have I done a live fetch for this segment yet" —
   *  deliberately NOT persisted (excluded in partialize below), unlike
   *  feedData itself. feedData can be non-null on mount purely from a
   *  rehydrated snapshot; gating fetchFeed on *that* would skip the one
   *  live revalidation a cold start actually needs. Same pattern
   *  hasFetchedForYou below already established for "For You". */
  hasFetchedFeed: Record<ActiveSegment, boolean>;
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
  /** Session-scoped fetch guard, same C13 reasoning as hasFetchedFeed —
   *  genreCovers is now persisted, so "is it non-empty" alone can no
   *  longer mean "already fetched this session". */
  hasFetchedGenreCovers: Record<ActiveSegment, boolean>;
  isLoadingGenreCovers: boolean;

  // "For You" cross-library recommendations. Keyed per-segment like
  // feedData now (2026-07-31 fix) — the backend seeds/ranks shows and
  // movies completely separately (recommendations_views.py), so the
  // client must not collapse the two into one shared list either, or
  // the Series and Movies tabs would keep showing whichever segment
  // fetched first.
  forYou: Record<ActiveSegment, ForYouItem[]>;
  hasFetchedForYou: Record<ActiveSegment, boolean>;
  isLoadingForYou: boolean;
  forYouError: string | null;

  // Actions
  setActiveSegment: (segment: ActiveSegment) => void;
  setSearchQuery: (query: string) => void;
  setSelectedGenreId: (genreId: number | null) => void;
  setSortOrder: (order: SortOrder) => void;
  setSelectedLanguage: (language: string | null) => void;
  setAnimeOnly: (animeOnly: boolean) => void;
  toggleFilterSheet: () => void;
  closeFilterSheet: () => void;
  fetchFeed: (segment: ActiveSegment, force?: boolean) => Promise<void>;
  runSearch: (query: string) => Promise<void>;
  loadMoreSearchResults: () => Promise<void>;
  clearSearch: () => void;
  fetchFilteredResults: () => Promise<void>;
  loadMoreFilteredResults: () => Promise<void>;
  resetFilters: () => void;
  isFilterActive: () => boolean;
  fetchGenreCovers: (segment: ActiveSegment) => Promise<void>;
  fetchForYou: (segment: ActiveSegment, force?: boolean) => Promise<void>;
}

export const useDiscoverStore = create<DiscoverState>()(
  persist(
    (set, get) => ({
  // Initial UI state
  activeSegment: 'tv',
  selectedProviderIds: [],
  monetization: 'flatrate|free|ads',
  watchRegion: 'IN',
  providerOptions: [],
  availableRegions: [],
  providerOptionsKey: null,
  isLoadingProviders: false,
  providersError: null,
  releases: { tv: null, movie: null },
  releasesKey: null,
  isLoadingReleases: false,
  releasesError: null,
  searchQuery: '',
  selectedGenreId: null,
  sortOrder: 'trending',
  selectedLanguage: null,
  animeOnly: false,
  filterSheetVisible: false,

  // Initial data state
  feedData: { tv: null, movie: null },
  feedFetchedAt: { tv: null, movie: null },
  hasFetchedFeed: { tv: false, movie: false },
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
  hasFetchedGenreCovers: { tv: false, movie: false },
  isLoadingGenreCovers: false,

  forYou: { tv: [], movie: [] },
  hasFetchedForYou: { tv: false, movie: false },
  isLoadingForYou: false,
  forYouError: null,

  // ── Actions ──────────────────────────────────────────────────────────────────

  isFilterActive: () => hasDiscoverFilters(get()),

  applyFilters: (filters) => {
    filteredAbortController?.abort();
    loadMoreFilteredAbortController?.abort();
    set({ ...filters, filteredResults: [], filteredError: null, filteredPage: 1, filteredTotalPages: 1, isLoadingFiltered: false, isLoadingMoreFiltered: false });
    if ((get().selectedProviderIds.length || get().monetization !== 'flatrate|free|ads') && get().sortOrder === 'trending') set({ sortOrder: 'popular' });
    if (get().isFilterActive()) void get().fetchFilteredResults();
  },
  setActiveSegment: (segment) => {
    const genres = segment === 'tv' ? TV_GENRES : MOVIE_GENRES;
    const selectedGenreId = get().selectedGenreId;
    set({ activeSegment: segment, selectedGenreId: genres.some((genre) => genre.id === selectedGenreId) ? selectedGenreId : null });
    filteredAbortController?.abort();
    loadMoreFilteredAbortController?.abort();
    set({ filteredResults: [], isLoadingFiltered: false, isLoadingMoreFiltered: false });
    if (get().isFilterActive()) void get().fetchFilteredResults();
    else void get().fetchFeed(segment);
    void get().fetchForYou(segment);
    void get().fetchGenreCovers(segment);
    void get().fetchReleases(segment);
    if (get().filterSheetVisible) void get().fetchProviders(segment);
  },
  setSearchQuery: (query) => {
    searchAbortController?.abort();
    loadMoreSearchAbortController?.abort();
    set({ searchQuery: query, searchResults: [], searchError: null, isSearching: !!query.trim(), isLoadingMoreSearch: false, searchPage: 1, searchTotalPages: 1 });
  },
  setSelectedGenreId: (genreId) => get().applyFilters({ selectedGenreId: genreId }),
  setSortOrder: (order) => get().applyFilters({ sortOrder: order }),
  setSelectedLanguage: (language) => get().applyFilters({ selectedLanguage: language, animeOnly: language !== null ? false : get().animeOnly }),
  setAnimeOnly: (animeOnly) => get().applyFilters({ animeOnly, selectedLanguage: animeOnly ? null : get().selectedLanguage }),
  setWatchRegion: (region) => {
    if (region === get().watchRegion) return;
    providersAbortController?.abort();
    releasesAbortController?.abort();
    set({ watchRegion: region, providerOptions: [], providerOptionsKey: null, releases: { tv: null, movie: null }, releasesKey: null });
    get().applyFilters({ selectedProviderIds: [] });
    void get().fetchProviders(get().activeSegment);
    void get().fetchReleases(get().activeSegment);
  },
  fetchProviders: async (segment) => {
    const region = get().watchRegion;
    const key = `${segment}-${region}`;
    if (get().providerOptionsKey === key) return;
    providersAbortController?.abort();
    const controller = new AbortController(); providersAbortController = controller;
    set({ isLoadingProviders: true, providersError: null, providerOptions: [], providerOptionsKey: null });
    try {
      const response = await api.get<{ providers: WatchProvider[]; regions: WatchRegion[] }>('/discover/providers/', { params: { type: segment, region }, signal: controller.signal });
      if (controller.signal.aborted) return;
      set({ providerOptions: response.data.providers, availableRegions: response.data.regions, providerOptionsKey: key, isLoadingProviders: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      set({ providersError: extractErrorMessage(error), isLoadingProviders: false });
    }
  },
  fetchReleases: async (segment, force = false) => {
    const region = get().watchRegion;
    if (!force && get().releases[segment] && get().releasesKey === region) return;
    releasesAbortController?.abort();
    const controller = new AbortController(); releasesAbortController = controller;
    set({ isLoadingReleases: true, releasesError: null });
    try {
      const response = await api.get<FeedSection>('/discover/releases/', { params: { type: segment, region }, signal: controller.signal });
      if (controller.signal.aborted) return;
      set((state) => ({ releases: { ...state.releases, [segment]: response.data }, releasesKey: region, isLoadingReleases: false }));
    } catch (error) {
      if (controller.signal.aborted) return;
      set({ releasesError: extractErrorMessage(error), isLoadingReleases: false });
    }
  },

  toggleFilterSheet: () =>
    set((state) => ({ filterSheetVisible: !state.filterSheetVisible })),

  closeFilterSheet: () => set({ filterSheetVisible: false }),

  fetchFeed: async (segment, force = false) => {
    // Skip if already fetched live this session — NOT the same check as
    // "feedData[segment] is non-null" (C13): feedData is now persisted, so
    // it can be non-null purely from a rehydrated snapshot on a cold
    // start, before this session has ever actually talked to the backend.
    // Gating on that would skip the one background revalidation a
    // stale-while-revalidate cold start is supposed to get.
    if (!force && get().hasFetchedFeed[segment] && Date.now() - (get().feedFetchedAt[segment] ?? 0) < 30 * 60 * 1000) return;

    feedAbortController?.abort();
    const controller = new AbortController();
    feedAbortController = controller;

    // Deliberately not clearing feedData/showing a blocking spinner here —
    // DiscoverFeedBody already renders real content whenever feedData[segment]
    // is non-null regardless of isLoadingFeed, which is what lets a stale
    // persisted snapshot stay on screen while this fetch resolves in the
    // background instead of flashing to a spinner.
    set({ isLoadingFeed: true, feedError: null });
    try {
      const response = await api.get<DiscoverFeedResponse>(
        `/discover/feed/?type=${segment}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      set((state) => ({
        feedData: { ...state.feedData, [segment]: response.data },
        feedFetchedAt: { ...state.feedFetchedAt, [segment]: Date.now() },
        hasFetchedFeed: { ...state.hasFetchedFeed, [segment]: true },
        isLoadingFeed: false,
      }));
    } catch (err) {
      // A stale/aborted fetch (e.g. a fast tv->movie->tv toggle, or the
      // screen unmounting mid-request) must still clear isLoadingFeed —
      // otherwise it's stuck true in the store forever, since nothing else
      // is going to resolve and flip it back. No feedError either: this
      // wasn't a real failure, just a superseded/cancelled request.
      if (controller.signal.aborted || axios.isCancel(err)) {
        return;
      }
      set({ feedError: extractErrorMessage(err), isLoadingFeed: false });
    }
  },

  fetchForYou: async (segment, force = false) => {
    // Backend caches the computed feed per-user *and per-segment* for 6h
    // already (recommendations_cache_key now takes media_type); this guard
    // just avoids a redundant request within the same app session, same
    // idea as fetchFeed's per-segment cache.
    if (!force && get().hasFetchedForYou[segment]) return;

    forYouAbortController?.abort();
    const controller = new AbortController();
    forYouAbortController = controller;

    set({ isLoadingForYou: true, forYouError: null });
    try {
      const response = await api.get<ForYouItem[]>('/recommendations/for-you/', {
        params: { type: segment },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      set((state) => ({
        forYou: { ...state.forYou, [segment]: response.data },
        hasFetchedForYou: { ...state.hasFetchedForYou, [segment]: true },
        isLoadingForYou: false,
      }));
    } catch (err) {
      if (controller.signal.aborted || axios.isCancel(err)) {
        return;
      }
      set({ forYouError: extractErrorMessage(err), isLoadingForYou: false });
    }
  },

  runSearch: async (query) => {
    searchAbortController?.abort();
    loadMoreSearchAbortController?.abort();
    set({ isLoadingMoreSearch: false });
    if (!query.trim()) {
      searchAbortController = null;
      set({ searchResults: [], isSearching: false, searchError: null, searchPage: 1, searchTotalPages: 1 });
      return;
    }
    const controller = new AbortController();
    searchAbortController = controller;

    set({ isSearching: true, searchError: null });
    try {
      const response = await api.get<UniversalSearchResponse>(
        `/search/universal/?query=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      set({
        searchResults: dedupeAppend([], response.data.results),
        searchPage: response.data.page,
        searchTotalPages: response.data.total_pages,
        isSearching: false,
      });
    } catch (err) {
      if (controller.signal.aborted || axios.isCancel(err)) return;
      set({ searchError: extractErrorMessage(err), isSearching: false, searchResults: [] });
    }
  },

  loadMoreSearchResults: async () => {
    const { searchQuery, searchPage, searchTotalPages, isSearching, isLoadingMoreSearch } = get();
    if (isSearching || isLoadingMoreSearch || !searchQuery.trim() || searchPage >= searchTotalPages) return;

    loadMoreSearchAbortController?.abort();
    const controller = new AbortController();
    loadMoreSearchAbortController = controller;

    set({ isLoadingMoreSearch: true });
    try {
      const nextPage = searchPage + 1;
      const response = await api.get<UniversalSearchResponse>(
        `/search/universal/?query=${encodeURIComponent(searchQuery)}&page=${nextPage}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      set((state) => ({
        searchResults: dedupeAppend(state.searchResults, response.data.results),
        searchPage: response.data.page,
        searchTotalPages: response.data.total_pages,
        isLoadingMoreSearch: false,
      }));
    } catch {
      if (controller.signal.aborted) return;
      // Best-effort — a failed "load more" tail request just means the
      // user can trigger it again by scrolling; not worth a full error
      // state for results that are already on screen. Same story for a
      // cancelled one (a fresh runSearch superseding this page request) —
      // no error field to skip setting either way.
      set({ isLoadingMoreSearch: false });
    }
  },

  clearSearch: () => {
    searchAbortController?.abort();
    loadMoreSearchAbortController?.abort();
    set({
      searchQuery: '',
      isLoadingMoreSearch: false,
      searchResults: [],
      isSearching: false,
      searchError: null,
      searchPage: 1,
      searchTotalPages: 1,
    });
  },

  fetchFilteredResults: async () => {
    // Had no guard at all — every genre/sort/language/anime toggle in the
    // Filter & Sort sheet calls this, and each one raced the last with no
    // way to know which response arrived for which filter combination.
    filteredAbortController?.abort();
    const controller = new AbortController();
    filteredAbortController = controller;

    loadMoreFilteredAbortController?.abort();
    set({ isLoadingFiltered: true, isLoadingMoreFiltered: false, filteredError: null });
    try {
      const params = filterParams(get());
      const response = await api.get<UniversalSearchResponse>('/discover/filter/', {
        params,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      set({
        filteredResults: dedupeAppend([], response.data.results),
        filteredPage: response.data.page,
        filteredTotalPages: response.data.total_pages,
        isLoadingFiltered: false,
      });
    } catch (err) {
      if (controller.signal.aborted || axios.isCancel(err)) return;
      set({ filteredError: extractErrorMessage(err), isLoadingFiltered: false, filteredResults: [] });
    }
  },

  loadMoreFilteredResults: async () => {
    const {
      filteredPage,
      filteredTotalPages,
      isLoadingFiltered,
      isLoadingMoreFiltered,
    } = get();
    if (isLoadingFiltered || isLoadingMoreFiltered || filteredPage >= filteredTotalPages) return;

    loadMoreFilteredAbortController?.abort();
    const controller = new AbortController();
    loadMoreFilteredAbortController = controller;

    set({ isLoadingMoreFiltered: true });
    try {
      const params = filterParams(get(), filteredPage + 1);
      const response = await api.get<UniversalSearchResponse>('/discover/filter/', {
        params,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      set((state) => ({
        filteredResults: dedupeAppend(state.filteredResults, response.data.results),
        filteredPage: response.data.page,
        filteredTotalPages: response.data.total_pages,
        isLoadingMoreFiltered: false,
      }));
    } catch {
      if (controller.signal.aborted) return;
      set({ isLoadingMoreFiltered: false });
    }
  },

  resetFilters: () => get().applyFilters({ selectedGenreId: null, sortOrder: 'trending', selectedLanguage: null, animeOnly: false, selectedProviderIds: [], monetization: 'flatrate|free|ads' }),

  fetchGenreCovers: async (segment) => {
    // Skip if already fetched live this session — same C13 reasoning as
    // fetchFeed's hasFetchedFeed guard above; genreCovers is persisted now,
    // so "is it non-empty" no longer means "already fetched this session".
    if (get().hasFetchedGenreCovers[segment]) return;

    genreCoversAbortController?.abort();
    const controller = new AbortController();
    genreCoversAbortController = controller;

    set({ isLoadingGenreCovers: true });
    try {
      const response = await api.get<GenreCover[]>('/discover/genres/', {
        params: { type: segment },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const bySegmentId: Record<number, GenreCover> = {};
      for (const cover of response.data) {
        bySegmentId[cover.id] = cover;
      }
      set((state) => ({
        genreCovers: { ...state.genreCovers, [segment]: bySegmentId },
        hasFetchedGenreCovers: { ...state.hasFetchedGenreCovers, [segment]: true },
        isLoadingGenreCovers: false,
      }));
    } catch {
      if (controller.signal.aborted) return;
      // Non-critical — GenreGrid falls back to a solid color card per genre.
      // Covers a real failure and a cancellation (superseded segment
      // switch) the same way, since there's no error UI tied to this flag.
      set({ isLoadingGenreCovers: false });
    }
  },
    }),
    {
      name: 'discover-store',
      storage: discoverStorage,
      onRehydrateStorage: () => () => {
        markStorageHydrated(discoverStorage);
      },
      // Only the curated feed/For You/genre covers are worth painting
      // stale on a cold start (C13) — search/filtered results are
      // query-specific snapshots, and every UI flag/error/pagination field
      // below must start fresh each session regardless of what the last
      // one left behind.
      partialize: (state) => ({
        feedData: state.feedData,
        feedFetchedAt: state.feedFetchedAt,
        forYou: state.forYou,
        genreCovers: state.genreCovers,
        watchRegion: state.watchRegion,
      }),
    }
  )
);
