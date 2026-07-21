// client-mobile/app/(tabs)/movies.tsx
// Glix V2 — Movies Hub
// Dense FlashList of movie rows with horizontal pill filters,
// animated checkmarks identical to Phase 2.5 ShowRow, and
// the same deferred-Zustand-update anti-jump pattern.

import { FlashList } from '@shopify/flash-list';
import { Film } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import GlassSurface from '../../components/GlassSurface';
import LayoutToggle from '../../components/LayoutToggle';
import MoviePosterCard from '../../components/MoviePosterCard';
import MovieRow from '../../components/MovieRow';
import PressableScale from '../../components/PressableScale';
import { useAppTheme } from '../../lib/theme';
import { useDiscoverStore } from '../../store/discoverStore';
import { MovieWatchlistItem, useWatchStore } from '../../store/watchStore';

// ─── Filter categories ────────────────────────────────────────────────────────

type FilterKey = 'WATCH_NEXT' | 'WATCHED';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'WATCH_NEXT', label: 'WATCH NEXT' },
  { key: 'WATCHED', label: 'WATCHED' },
];

function formatRuntime(minutes: number): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Filter Pill ──────────────────────────────────────────────────────────────

function FilterPill({
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
        styles.pill,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { borderColor: c.accentFill, backgroundColor: c.accentFill },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.pillText, { color: c.textSecondary }, active && { color: c.onAccent }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MoviesScreen() {
  const router = useRouter();
  // Scoped selectors, not a bare useWatchStore() — see app/_layout.tsx's note.
  const movieWatchlist = useWatchStore((s) => s.movieWatchlist);
  const isLoadingMovies = useWatchStore((s) => s.isLoadingMovies);
  const error = useWatchStore((s) => s.error);
  const clearError = useWatchStore((s) => s.clearError);
  const fetchMovieWatchlist = useWatchStore((s) => s.fetchMovieWatchlist);
  const toggleMovieWatchState = useWatchStore((s) => s.toggleMovieWatchState);
  const preferredLayout = useWatchStore((s) => s.preferredLayout);
  const { highlightFilter } = useLocalSearchParams<{ highlightFilter?: string }>();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const [filter, setFilter] = useState<FilterKey>('WATCH_NEXT');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Arriving from "Add to Watchlist" (movie detail) passes highlightFilter
  // so the newly added movie's bucket is on-screen immediately.
  useEffect(() => {
    if (highlightFilter && FILTERS.some((f) => f.key === highlightFilter)) {
      setFilter(highlightFilter as FilterKey);
    }
  }, [highlightFilter]);

  useEffect(() => {
    fetchMovieWatchlist();
  }, [fetchMovieWatchlist]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchMovieWatchlist();
    setIsRefreshing(false);
  }, [fetchMovieWatchlist]);

  // Build the FlashList data from the current filter.
  // We keep items in the list until onAnimationComplete fires to avoid jumps.
  const rows = useMemo<MovieWatchlistItem[]>(() => {
    if (filter === 'WATCH_NEXT') return movieWatchlist.watch_next;
    return movieWatchlist.watched;
  }, [movieWatchlist, filter]);

  const handleCheckPress = useCallback(
    (movieId: number) => {
      const item = [...movieWatchlist.watch_next, ...movieWatchlist.watched].find(
        (i) => i.movie.tmdb_id === movieId
      );
      if (!item) return;

      if (item.movie.is_watched) {
        // Un-watching: update immediately, no exit animation needed
        toggleMovieWatchState(movieId);
      }
      // Watching path: handled by onAnimationComplete (see below)
    },
    [movieWatchlist, toggleMovieWatchState]
  );

  /** Fires after the row's collapse animation finishes.
   *  This is when we flush the Zustand update so the row is truly
   *  gone before the list re-renders — prevents layout jumps. */
  const handleAnimationComplete = useCallback(
    (movieId: number) => {
      toggleMovieWatchState(movieId);
    },
    [toggleMovieWatchState]
  );

  const renderItem = useCallback(
    ({ item }: { item: MovieWatchlistItem }) => (
      <MovieRow
        movieId={item.movie.tmdb_id}
        title={item.movie.title}
        posterPath={item.movie.poster_path}
        runtimeMinutes={item.movie.runtime_minutes}
        genresString={item.movie.genres_string}
        isWatched={item.movie.is_watched}
        onCheckPress={handleCheckPress}
        onAnimationComplete={handleAnimationComplete}
      />
    ),
    [handleCheckPress, handleAnimationComplete]
  );

  const renderGridItem = useCallback(
    ({ item }: { item: MovieWatchlistItem }) => {
      const runtime = formatRuntime(item.movie.runtime_minutes);
      const subtitle = [runtime, item.movie.genres_string].filter(Boolean).join(' · ');
      return (
        <MoviePosterCard
          movieId={item.movie.tmdb_id}
          title={item.movie.title}
          posterPath={item.movie.poster_path}
          subtitle={subtitle || undefined}
          ratingBadge={item.movie.vote_average > 0 ? `★ ${item.movie.vote_average.toFixed(1)}` : undefined}
          checkmark={{
            isWatched: item.movie.is_watched,
            onPress: () => toggleMovieWatchState(item.movie.tmdb_id),
          }}
        />
      );
    },
    [toggleMovieWatchState]
  );

  const isEmpty = rows.length === 0 && !isLoadingMovies;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Movies</Text>
        <View style={styles.headerRight}>
          <LayoutToggle />
          <PressableScale
            style={[
              styles.headerIcon,
              { backgroundColor: c.glassFill, borderColor: c.hairline },
            ]}
            onPress={() => {
              useDiscoverStore.getState().setActiveSegment('movie');
              router.push('/(tabs)/discover');
            }}
          >
            <Film color={c.accentInk} size={22} strokeWidth={2} />
          </PressableScale>
        </View>
      </View>

      {/* ── Error Banner ── */}
      {error && (
        <PressableScale
          style={[
            styles.errorBanner,
            { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' },
          ]}
          onPress={clearError}
        >
          <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
        </PressableScale>
      )}

      {/* ── Filter Pills ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsContainer}
        style={styles.pillsScroll}
      >
        {FILTERS.map((f) => (
          <FilterPill
            key={f.key}
            label={f.label}
            active={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </ScrollView>

      {/* ── Content ── */}
      {isLoadingMovies && rows.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      ) : isEmpty ? (
        <View style={styles.centered}>
          <GlassSurface radius={20} style={styles.emptyCard}>
            <Film color={c.textTertiary} size={56} strokeWidth={1.5} />
            <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>
              {filter === 'WATCH_NEXT' ? 'No movies in your queue' : 'No watched movies yet'}
            </Text>
            <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
              {filter === 'WATCH_NEXT'
                ? 'Add movies from the Discover tab to build your watch list.'
                : 'Check a movie as watched and it will appear here.'}
            </Text>

            {filter === 'WATCH_NEXT' && (
              <PressableScale
                style={[styles.browseButton, { backgroundColor: c.accentFill }]}
                onPress={() => router.push('/(tabs)/discover')}
              >
                <Text style={[styles.browseButtonText, { color: c.onAccent }]}>Browse All Movies</Text>
              </PressableScale>
            )}
          </GlassSurface>
        </View>
      ) : (
        <FlashList
          key={`movies-${preferredLayout}`}
          data={rows}
          keyExtractor={(item) => String(item.movie.tmdb_id)}
          renderItem={preferredLayout === 'grid' ? renderGridItem : renderItem}
          numColumns={preferredLayout === 'grid' ? 2 : 1}
          extraData={preferredLayout}
          estimatedItemSize={preferredLayout === 'grid' ? 260 : 108}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={c.accentInk}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { fontSize: 13 },
  pillsScroll: { flexGrow: 0 },
  pillsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    flexDirection: 'row',
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 120,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 28,
    paddingVertical: 36,
    width: '100%',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  browseButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  browseButtonText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
