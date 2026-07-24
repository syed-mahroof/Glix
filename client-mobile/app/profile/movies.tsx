// client-mobile/app/profile/movies.tsx
// Phase 5: Profile > My Movies — full movie watchlist with filter pills.

import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft, Clapperboard, Film, Palette, Search, Sparkles, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FloatingFilterButton from '../../components/FloatingFilterButton';
import LanguageFilterModal, { languageDisplayName } from '../../components/LanguageFilterModal';
import LayoutToggle from '../../components/LayoutToggle';
import MoviePosterCard from '../../components/MoviePosterCard';
import PressableScale from '../../components/PressableScale';
import WatchlistFilterSheet from '../../components/WatchlistFilterSheet';
import { hasAnimationGenreString, isAnimeByGenreStringAndLanguage } from '../../lib/anime';
import { useAppTheme } from '../../lib/theme';
import { MovieWatchlistItem } from '../../store/watchStore';
import { useWatchStore } from '../../store/watchStore';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185';

// Last Watched is a single-select tab option here too (Phase 63), same as
// shows.tsx — sorts the full list by recency (updated_at doubles as "last
// watched" for movies, see toggleMovieWatchState) rather than narrowing it.
type FilterKey = 'ALL' | 'WATCH_NEXT' | 'WATCHED' | 'LAST_WATCHED';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'WATCH_NEXT', label: 'Watch Next' },
  { key: 'WATCHED', label: 'Watched' },
  { key: 'LAST_WATCHED', label: 'Last Watched' },
];

function TabPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale
      style={[
        styles.tabPill,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { backgroundColor: c.accentFill, borderColor: c.accentFill },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabPillText, { color: c.textSecondary }, active && { color: c.onAccent }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

function formatRuntime(minutes: number): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function MovieListRow({ item }: { item: MovieWatchlistItem }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { movie } = item;
  return (
    <PressableScale
      style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
      onPress={() => router.push(`/movie/${movie.tmdb_id}` as any)}
    >
      {/* Poster */}
      <View style={[styles.posterWrap, { backgroundColor: c.bgElevated }]}>
        <Image
          source={
            movie.poster_path
              ? { uri: `${POSTER_BASE}${movie.poster_path}` }
              : undefined
          }
          style={styles.poster}
          contentFit="cover"
          transition={200}
        />
        {/* Watch state overlay — a checkmark painted on top of the poster
            photo, not the app's own background, so it stays a fixed dark
            scrim in both themes (same "caption on a photo" precedent as
            show/[id].tsx's backdrop). */}
        {movie.is_watched && (
          <View style={styles.watchedOverlay}>
            <Text style={[styles.watchedCheck, { color: c.accentFill }]}>✓</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.rowContent}>
        <Text style={[styles.movieTitle, { color: c.textPrimary }]} numberOfLines={2}>
          {movie.title}
        </Text>

        {/* Runtime */}
        {movie.runtime_minutes > 0 && (
          <Text style={[styles.meta, { color: c.textSecondary }]}>{formatRuntime(movie.runtime_minutes)}</Text>
        )}

        {/* Genre */}
        {movie.genres_string ? (
          <Text style={[styles.meta, { color: c.textSecondary }]} numberOfLines={1}>
            {movie.genres_string}
          </Text>
        ) : null}

        {/* Watch status badge */}
        <View
          style={[
            styles.statusPill,
            movie.is_watched
              ? styles.statusPillWatched
              : { backgroundColor: c.accentDim, borderColor: c.accentInk },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              movie.is_watched ? styles.statusTextWatched : { color: c.accentInk },
            ]}
          >
            {movie.is_watched ? '✓ Watched' : '⏳ Watch Next'}
          </Text>
        </View>

        {/* Rating — gold star, pre-existing non-token color, unrelated to light/dark. */}
        {movie.vote_average > 0 && (
          <Text style={styles.rating}>★ {movie.vote_average.toFixed(1)}</Text>
        )}
      </View>
    </PressableScale>
  );
}

function MovieGridCard({ item }: { item: MovieWatchlistItem }) {
  const { movie } = item;
  // Read-only browse screen (no toggle interaction here, unlike the Movies
  // Hub) — watched state takes the one overlay-badge slot when true, since
  // it matters more than the rating; rating still surfaces in the subtitle.
  const runtimeGenres = [formatRuntime(movie.runtime_minutes), movie.genres_string]
    .filter(Boolean)
    .join(' · ');
  const rating = movie.vote_average > 0 ? `★ ${movie.vote_average.toFixed(1)}` : '';
  const subtitle = [runtimeGenres, movie.is_watched ? rating : ''].filter(Boolean).join(' · ');
  return (
    <MoviePosterCard
      movieId={movie.tmdb_id}
      title={movie.title}
      posterPath={movie.poster_path}
      subtitle={subtitle || undefined}
      ratingBadge={movie.is_watched ? '✓ WATCHED' : rating || undefined}
    />
  );
}

export default function ProfileMoviesScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  // Scoped selectors, not a bare useWatchStore() — see app/_layout.tsx's note.
  const movieWatchlist = useWatchStore((s) => s.movieWatchlist);
  const isLoadingMovies = useWatchStore((s) => s.isLoadingMovies);
  const fetchMovieWatchlist = useWatchStore((s) => s.fetchMovieWatchlist);
  const preferredLayout = useWatchStore((s) => s.preferredLayout);
  const selectedLanguage = useWatchStore((s) => s.selectedLanguage);
  const setLanguageFilter = useWatchStore((s) => s.setLanguageFilter);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [query, setQuery] = useState('');
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState(false);
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  const [animeOnly, setAnimeOnly] = useState(false);
  const [animationOnly, setAnimationOnly] = useState(false);
  // Derived from the tab selection, not independent state — see shows.tsx's
  // identical comment (Phase 63).
  const lastWatchedSort = filter === 'LAST_WATCHED';

  useEffect(() => {
    fetchMovieWatchlist();
  }, [fetchMovieWatchlist]);

  const allItems = useMemo(() => {
    return [...movieWatchlist.watch_next, ...movieWatchlist.watched];
  }, [movieWatchlist]);

  // Distinct languages present in the user's own cached movie watchlist —
  // never TMDB's full language list, and never a new request (client-side only).
  const availableLanguages = useMemo(() => {
    const codes = new Set<string>();
    allItems.forEach((item) => {
      if (item.movie.original_language) codes.add(item.movie.original_language);
    });
    return Array.from(codes).sort();
  }, [allItems]);

  const filtered = useMemo(() => {
    let result =
      filter === 'WATCH_NEXT' ? movieWatchlist.watch_next : filter === 'WATCHED' ? movieWatchlist.watched : allItems;

    if (selectedLanguage) {
      result = result.filter((item) => item.movie.original_language === selectedLanguage);
    }

    if (animeOnly) {
      result = result.filter((item) =>
        isAnimeByGenreStringAndLanguage(item.movie.genres_string, item.movie.original_language)
      );
    }

    if (animationOnly) {
      result = result.filter((item) => hasAnimationGenreString(item.movie.genres_string));
    }

    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery) {
      result = result.filter((item) => item.movie.title.toLowerCase().includes(trimmedQuery));
    }

    if (lastWatchedSort) {
      // `updated_at` doubles as "last watched" here — see the client-side
      // stamp added to toggleMovieWatchState (Phase 57); most-recent first.
      result = [...result].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    return result;
  }, [allItems, filter, selectedLanguage, animeOnly, animationOnly, movieWatchlist, query, lastWatchedSort]);

  const hasActiveFilters =
    filter !== 'ALL' || selectedLanguage !== null || animeOnly || animationOnly;

  const handleReset = () => {
    setFilter('ALL');
    setLanguageFilter(null);
    setAnimeOnly(false);
    setAnimationOnly(false);
  };

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
          <Film color={c.accentInk} size={20} strokeWidth={1.75} />
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>My Movies</Text>
        </View>
        <LayoutToggle />
      </View>

      {/* Status/sort tabs — top-of-screen horizontal pill row (Phase 63),
          not a filter-sheet section. Single-select; tapping the active
          pill again returns to "All". */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContainer}
        style={styles.tabsScroll}
      >
        {FILTERS.map((f) => (
          <TabPill
            key={f.key}
            label={f.label}
            active={filter === f.key}
            onPress={() => setFilter(filter === f.key ? 'ALL' : f.key)}
          />
        ))}
      </ScrollView>

      {/* Search — client-side filter over the already-loaded movie watchlist. */}
      <View style={styles.searchRow}>
        <View style={[styles.searchInputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <Search color={c.textTertiary} size={16} />
          <TextInput
            style={[styles.searchInput, { color: c.textPrimary }]}
            placeholder="Search your movies"
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
      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Clapperboard color={c.textTertiary} size={48} strokeWidth={1.25} />
          <Text style={[styles.emptyTitle, { color: c.textSecondary }]}>
            {query.trim() ? 'No matches' : 'No movies here yet'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
            {query.trim()
              ? `No movies match "${query.trim()}".`
              : !hasActiveFilters
              ? 'Add movies from the Movies tab or Discover.'
              : 'No movies match this filter.'}
          </Text>
        </View>
      ) : (
        <View style={styles.listWrap}>
          <FlashList
            key={`profile-movies-${preferredLayout}`}
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            numColumns={preferredLayout === 'grid' ? 3 : 1}
            extraData={preferredLayout}
            renderItem={({ item }) =>
              preferredLayout === 'grid' ? <MovieGridCard item={item} /> : <MovieListRow item={item} />
            }
            contentContainerStyle={styles.listContent}
            refreshing={isLoadingMovies}
            onRefresh={fetchMovieWatchlist}
          />
        </View>
      )}

      {/* Filter sheet — rendered last (after the list), not before it. See
          shows.tsx's identical comment for why (Phase 63): React Native has
          no implicit z-index across siblings, so mounting an absolutely-
          positioned overlay before the FlashList let the list paint over
          it. Matches DiscoverFilterSheet's own placement in discover.tsx. */}
      <WatchlistFilterSheet
        visible={isFilterSheetVisible}
        onClose={() => setIsFilterSheetVisible(false)}
        title="Filter Movies"
        selectedLanguage={selectedLanguage}
        onOpenLanguagePicker={() => setIsLanguageModalVisible(true)}
        languageDisplay={selectedLanguage ? languageDisplayName(selectedLanguage) : 'Any Language'}
        tagToggles={[
          {
            key: 'anime',
            label: 'Anime',
            Icon: Sparkles,
            active: animeOnly,
            onPress: () => setAnimeOnly((prev) => !prev),
          },
          {
            key: 'animation',
            label: 'Animation',
            Icon: Palette,
            active: animationOnly,
            onPress: () => setAnimationOnly((prev) => !prev),
          },
        ]}
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

  tabsScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: '600',
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

  row: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    overflow: 'hidden',
  },

  posterWrap: {
    width: 64,
    height: 96,
  },
  poster: { width: '100%', height: '100%' },

  // Photo-caption overlay — fixed dark scrim over the poster photo,
  // theme-invariant by design (see comment at the call site).
  watchedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedCheck: {
    fontSize: 22,
    fontWeight: '900',
  },

  rowContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 5,
    justifyContent: 'center',
  },
  movieTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    fontWeight: '500',
  },

  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  // Green "watched" hue is a pre-existing non-token color, unrelated to
  // light/dark theming — left as-is (same precedent as a gold rating star).
  statusPillWatched: {
    backgroundColor: 'rgba(76,175,80,0.1)',
    borderColor: 'rgba(76,175,80,0.4)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextWatched: { color: '#4CAF50' },

  // Gold rating star — pre-existing non-token color, unrelated to light/dark.
  rating: {
    color: '#FFD700',
    fontSize: 11,
    fontWeight: '700',
  },

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
