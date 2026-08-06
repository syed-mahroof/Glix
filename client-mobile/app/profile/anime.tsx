// client-mobile/app/profile/anime.tsx
// Phase 75.2: Profile > My Anime — anime shows and anime movies (Animation
// genre + Japanese original_language, lib/anime.ts) get their own screen
// instead of being an optional filter buried inside My Shows/My Movies.
// Shows a Shows|Movies segmented control rather than two separate routes,
// mirroring how Upcoming's List/Grid/Calendar switch lives inside one
// screen — reuses profile/shows.tsx's and profile/movies.tsx's own row/card
// components rather than a third copy of the same rendering logic.

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ArrowLeft, Search, Sparkles, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FloatingFilterButton from '../../components/FloatingFilterButton';
import LanguageFilterModal, { languageDisplayName } from '../../components/LanguageFilterModal';
import LayoutToggle from '../../components/LayoutToggle';
import PressableScale from '../../components/PressableScale';
import { SegmentedControl } from '../../components/SegmentedControl';
import TabPill from '../../components/TabPill';
import WatchlistFilterSheet from '../../components/WatchlistFilterSheet';
import { isAnimeByGenresAndLanguage, isAnimeByGenreStringAndLanguage } from '../../lib/anime';
import { useAppTheme } from '../../lib/theme';
import { useLayoutFor, useWatchStore, type MovieWatchlistItem, type WatchlistEntry } from '../../store/watchStore';
import { MovieGridCard, MovieListRow } from './movies';
import { ShowGridCard, ShowListRow } from './shows';

type AnimeSegment = 'shows' | 'movies';

// Phase 75.3: My Anime's Shows segment mirrors My Shows' pill set
// (profile/shows.tsx) and its Movies segment mirrors My Movies' pill set
// (profile/movies.tsx) — predicates copied verbatim from each, not
// imported, since the two screens' FILTERS/FilterKey aren't exported (each
// stays the source of truth for its own screen). Two separate state
// variables so a shows-only key can't leak into the movies branch when the
// segmented control flips.
type ShowsFilterKey = 'ALL' | 'TO_WATCH' | 'LAST_WATCHED' | 'ENDED';
type MoviesFilterKey = 'ALL' | 'WATCH_NEXT' | 'WATCHED' | 'LAST_WATCHED';

const SHOWS_FILTERS: { key: ShowsFilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'TO_WATCH', label: 'Continuing' },
  { key: 'LAST_WATCHED', label: 'Last Watched' },
  { key: 'ENDED', label: 'Ended' },
];

const MOVIES_FILTERS: { key: MoviesFilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'WATCH_NEXT', label: 'Watch Next' },
  { key: 'WATCHED', label: 'Watched' },
  { key: 'LAST_WATCHED', label: 'Last Watched' },
];

export default function ProfileAnimeScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  // Scoped selectors, not a bare useWatchStore() — see app/_layout.tsx's note.
  const watchlist = useWatchStore((s) => s.watchlist);
  const movieWatchlist = useWatchStore((s) => s.movieWatchlist);
  const isLoadingWatchlist = useWatchStore((s) => s.isLoadingWatchlist);
  const isLoadingMovies = useWatchStore((s) => s.isLoadingMovies);
  const fetchWatchlist = useWatchStore((s) => s.fetchWatchlist);
  const fetchMovieWatchlist = useWatchStore((s) => s.fetchMovieWatchlist);
  const layout = useLayoutFor('myAnime');
  const selectedLanguage = useWatchStore((s) => s.selectedLanguage);
  const setLanguageFilter = useWatchStore((s) => s.setLanguageFilter);

  const [segment, setSegment] = useState<AnimeSegment>('shows');
  const [showsFilter, setShowsFilter] = useState<ShowsFilterKey>('ALL');
  const [moviesFilter, setMoviesFilter] = useState<MoviesFilterKey>('ALL');
  const [query, setQuery] = useState('');
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState(false);
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  // Derived from the pill selection, not independent state — same
  // single-select-row convention as shows.tsx/movies.tsx (Phase 63).
  const showsLastWatchedSort = showsFilter === 'LAST_WATCHED';
  const moviesLastWatchedSort = moviesFilter === 'LAST_WATCHED';

  useEffect(() => {
    fetchWatchlist();
    fetchMovieWatchlist();
  }, [fetchWatchlist, fetchMovieWatchlist]);

  const animeShowEntries = useMemo<WatchlistEntry[]>(() => {
    return [
      ...watchlist.to_watch.results,
      ...watchlist.up_to_date.results,
      ...watchlist.archived.results,
    ].filter((e) => isAnimeByGenresAndLanguage(e.show.genres, e.show.original_language));
  }, [watchlist]);

  const animeMovieWatchNext = useMemo<MovieWatchlistItem[]>(() => {
    return movieWatchlist.watch_next.filter((item) =>
      isAnimeByGenreStringAndLanguage(item.movie.genres_string, item.movie.original_language)
    );
  }, [movieWatchlist.watch_next]);

  const animeMovieWatched = useMemo<MovieWatchlistItem[]>(() => {
    return movieWatchlist.watched.filter((item) =>
      isAnimeByGenreStringAndLanguage(item.movie.genres_string, item.movie.original_language)
    );
  }, [movieWatchlist.watched]);

  const animeMovieItems = useMemo<MovieWatchlistItem[]>(
    () => [...animeMovieWatchNext, ...animeMovieWatched],
    [animeMovieWatchNext, animeMovieWatched]
  );

  // Distinct languages present in the active segment's anime items only —
  // client-side, never a new request, same convention as My Shows/My Movies.
  const availableLanguages = useMemo(() => {
    const codes = new Set<string>();
    if (segment === 'shows') {
      animeShowEntries.forEach((e) => {
        if (e.show.original_language) codes.add(e.show.original_language);
      });
    } else {
      animeMovieItems.forEach((item) => {
        if (item.movie.original_language) codes.add(item.movie.original_language);
      });
    }
    return Array.from(codes).sort();
  }, [segment, animeShowEntries, animeMovieItems]);

  const filteredShows = useMemo(() => {
    let result = animeShowEntries;
    // Predicates copied verbatim from shows.tsx:222-248.
    if (showsFilter === 'TO_WATCH') result = result.filter((e) => e.status === 'TO_WATCH' && e.show.status !== 'ENDED');
    else if (showsFilter === 'ENDED') result = result.filter((e) => e.show.status === 'ENDED');

    if (selectedLanguage) result = result.filter((e) => e.show.original_language === selectedLanguage);
    const trimmed = query.trim().toLowerCase();
    if (trimmed) result = result.filter((e) => e.show.title.toLowerCase().includes(trimmed));

    if (showsLastWatchedSort) {
      result = [...result].sort((a, b) => {
        if (!a.last_watched_at && !b.last_watched_at) return 0;
        if (!a.last_watched_at) return 1;
        if (!b.last_watched_at) return -1;
        return b.last_watched_at.localeCompare(a.last_watched_at);
      });
    }
    return result;
  }, [animeShowEntries, showsFilter, selectedLanguage, query, showsLastWatchedSort]);

  const filteredMovies = useMemo(() => {
    // Predicates copied verbatim from movies.tsx:232-263.
    let result =
      moviesFilter === 'WATCH_NEXT'
        ? animeMovieWatchNext
        : moviesFilter === 'WATCHED' || moviesFilter === 'LAST_WATCHED'
        ? animeMovieWatched
        : animeMovieItems;

    if (selectedLanguage) result = result.filter((item) => item.movie.original_language === selectedLanguage);
    const trimmed = query.trim().toLowerCase();
    if (trimmed) result = result.filter((item) => item.movie.title.toLowerCase().includes(trimmed));

    if (moviesLastWatchedSort) {
      result = [...result].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    return result;
  }, [animeMovieItems, animeMovieWatchNext, animeMovieWatched, moviesFilter, selectedLanguage, query, moviesLastWatchedSort]);

  const hasActiveFilters =
    (segment === 'shows' ? showsFilter !== 'ALL' : moviesFilter !== 'ALL') || selectedLanguage !== null;

  const handleReset = () => {
    if (segment === 'shows') setShowsFilter('ALL');
    else setMoviesFilter('ALL');
    setLanguageFilter(null);
  };
  const isEmpty = segment === 'shows' ? filteredShows.length === 0 : filteredMovies.length === 0;
  const isLoading = segment === 'shows' ? isLoadingWatchlist : isLoadingMovies;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <PressableScale
          style={[styles.backBtn, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
          onPress={() => router.back()}
        >
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <View style={styles.headerCenter}>
          <Sparkles color={c.accentInk} size={20} strokeWidth={1.75} />
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>My Anime</Text>
        </View>
        <LayoutToggle scope="myAnime" />
      </View>

      <View style={styles.segmentWrap}>
        <SegmentedControl
          segments={[
            { value: 'shows', label: 'Shows' },
            { value: 'movies', label: 'Movies' },
          ]}
          selectedValue={segment}
          onValueChange={setSegment}
        />
      </View>

      {/* Status/sort tabs — mirrors My Shows' pill row on the Shows segment
          and My Movies' pill row on the Movies segment (Phase 75.3). Same
          horizontal single-select convention; tapping the active pill again
          returns to "All". */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContainer}
        style={styles.tabsScroll}
      >
        {segment === 'shows'
          ? SHOWS_FILTERS.map((f) => (
              <TabPill
                key={f.key}
                label={f.label}
                active={showsFilter === f.key}
                onPress={() => setShowsFilter(showsFilter === f.key ? 'ALL' : f.key)}
              />
            ))
          : MOVIES_FILTERS.map((f) => (
              <TabPill
                key={f.key}
                label={f.label}
                active={moviesFilter === f.key}
                onPress={() => setMoviesFilter(moviesFilter === f.key ? 'ALL' : f.key)}
              />
            ))}
      </ScrollView>

      {/* Search — client-side over the already-loaded watchlist/movie cache,
          same as My Shows/My Movies. */}
      <View style={styles.searchRow}>
        <View style={[styles.searchInputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <Search color={c.textTertiary} size={16} />
          <TextInput
            style={[styles.searchInput, { color: c.textPrimary }]}
            placeholder={segment === 'shows' ? 'Search your anime shows' : 'Search your anime movies'}
            placeholderTextColor={c.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <PressableScale onPress={() => setQuery('')} hitSlop={8}>
              <X color={c.textTertiary} size={16} />
            </PressableScale>
          )}
        </View>
      </View>

      <LanguageFilterModal
        visible={isLanguageModalVisible}
        languages={availableLanguages}
        selected={selectedLanguage}
        onSelect={setLanguageFilter}
        onClose={() => setIsLanguageModalVisible(false)}
      />

      {/* List */}
      {isEmpty ? (
        <View style={styles.empty}>
          <Sparkles color={c.textTertiary} size={48} strokeWidth={1.25} />
          <Text style={[styles.emptyTitle, { color: c.textSecondary }]}>
            {query.trim() ? 'No matches' : `No anime ${segment} tracked yet`}
          </Text>
          <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
            {query.trim()
              ? `No anime ${segment} match "${query.trim()}".`
              : !hasActiveFilters
              ? `Anime ${segment} you track will show up here.`
              : `No anime ${segment} match this filter.`}
          </Text>
        </View>
      ) : segment === 'shows' ? (
        <View style={styles.listWrap}>
          <FlashList
            // Perf fix (2026-08-07): no remount needed for a numColumns
            // change — see (tabs)/index.tsx's identical note.
            data={filteredShows}
            keyExtractor={(item) => String(item.id)}
            numColumns={layout === 'grid' ? 3 : 1}
            extraData={layout}
            renderItem={({ item }) =>
              layout === 'grid' ? <ShowGridCard entry={item} /> : <ShowListRow entry={item} />
            }
            contentContainerStyle={styles.listContent}
            refreshing={isLoading}
            onRefresh={fetchWatchlist}
          />
        </View>
      ) : (
        <View style={styles.listWrap}>
          <FlashList
            // Perf fix (2026-08-07): no remount needed for a numColumns
            // change — see (tabs)/index.tsx's identical note.
            data={filteredMovies}
            keyExtractor={(item) => String(item.id)}
            numColumns={layout === 'grid' ? 3 : 1}
            extraData={layout}
            renderItem={({ item }) =>
              layout === 'grid' ? <MovieGridCard item={item} /> : <MovieListRow item={item} />
            }
            contentContainerStyle={styles.listContent}
            refreshing={isLoading}
            onRefresh={fetchMovieWatchlist}
          />
        </View>
      )}

      {/* Filter sheet — rendered last (after the list), not before it; same
          z-index-via-mount-order reasoning as shows.tsx/movies.tsx. Language
          only — there's no Tags section here since this list is already
          scoped to anime, and WatchlistFilterSheet hides an empty Tags
          section on its own (tagToggles.length > 0 guard). */}
      <WatchlistFilterSheet
        visible={isFilterSheetVisible}
        onClose={() => setIsFilterSheetVisible(false)}
        title={segment === 'shows' ? 'Filter Anime Shows' : 'Filter Anime Movies'}
        selectedLanguage={selectedLanguage}
        onOpenLanguagePicker={() => setIsLanguageModalVisible(true)}
        languageDisplay={selectedLanguage ? languageDisplayName(selectedLanguage) : 'Any Language'}
        tagToggles={[]}
        hasActiveFilters={hasActiveFilters}
        onReset={handleReset}
      />

      <FloatingFilterButton onPress={() => setIsFilterSheetVisible(true)} active={hasActiveFilters} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },

  segmentWrap: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },

  tabsScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },

  searchRow: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  listWrap: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
    marginTop: -60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
});
