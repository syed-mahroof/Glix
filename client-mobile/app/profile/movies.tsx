// client-mobile/app/profile/movies.tsx
// Phase 5: Profile > My Movies — full movie watchlist with filter pills.

import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft, Clapperboard, Film, Languages, Search, Sparkles, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import LanguageFilterModal, { languageDisplayName } from '../../components/LanguageFilterModal';
import LayoutToggle from '../../components/LayoutToggle';
import MoviePosterCard from '../../components/MoviePosterCard';
import PressableScale from '../../components/PressableScale';
import { isAnimeByGenreStringAndLanguage } from '../../lib/anime';
import { useAppTheme } from '../../lib/theme';
import { MovieWatchlistItem } from '../../store/watchStore';
import { useWatchStore } from '../../store/watchStore';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185';

type FilterKey = 'ALL' | 'WATCH_NEXT' | 'WATCHED';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'WATCH_NEXT', label: 'Watch Next' },
  { key: 'WATCHED', label: 'Watched' },
];

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
  const [animeOnly, setAnimeOnly] = useState(false);

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

    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery) {
      result = result.filter((item) => item.movie.title.toLowerCase().includes(trimmedQuery));
    }
    return result;
  }, [allItems, filter, selectedLanguage, animeOnly, movieWatchlist, query]);

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

      {/* Filter Pills — horizontally scrollable (Phase H): see profile/shows.tsx
          for the identical fix and the reason it was needed. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        {FILTERS.map(({ key, label }) => (
          <PressableScale
            key={key}
            style={[
              styles.pill,
              { backgroundColor: c.glassFill, borderColor: c.hairline },
              filter === key && { backgroundColor: c.accentFill, borderColor: c.accentFill },
            ]}
            onPress={() => setFilter(key)}
          >
            <Text style={[styles.pillText, { color: c.textSecondary }, filter === key && { color: c.onAccent }]}>
              {label}
            </Text>
          </PressableScale>
        ))}
        <PressableScale
          style={[
            styles.pill,
            styles.languagePill,
            { backgroundColor: c.glassFill, borderColor: c.hairline },
            selectedLanguage && { backgroundColor: c.accentFill, borderColor: c.accentFill },
          ]}
          onPress={() => setIsLanguageModalVisible(true)}
        >
          <Languages color={selectedLanguage ? c.onAccent : c.textSecondary} size={14} />
          <Text style={[styles.pillText, { color: c.textSecondary }, selectedLanguage && { color: c.onAccent }]}>
            {selectedLanguage ? languageDisplayName(selectedLanguage) : 'Language'}
          </Text>
        </PressableScale>
        <PressableScale
          style={[
            styles.pill,
            styles.languagePill,
            { backgroundColor: c.glassFill, borderColor: c.hairline },
            animeOnly && { backgroundColor: c.accentFill, borderColor: c.accentFill },
          ]}
          onPress={() => setAnimeOnly((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ selected: animeOnly }}
        >
          <Sparkles color={animeOnly ? c.onAccent : c.textSecondary} size={14} />
          <Text style={[styles.pillText, { color: c.textSecondary }, animeOnly && { color: c.onAccent }]}>
            Anime
          </Text>
        </PressableScale>
      </ScrollView>

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
              : filter === 'ALL' && !selectedLanguage
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
  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  languagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
