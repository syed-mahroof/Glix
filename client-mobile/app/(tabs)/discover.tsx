// client-mobile/app/(tabs)/discover.tsx
// Glix V2 — Discover Hub (Phase 4 Full Rebuild)
// Universal search + segmented TV/Movie feed + filter bottom sheet.

import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Film, SlidersHorizontal, Tv, WifiOff, X } from 'lucide-react-native';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';

import DiscoverFilterSheet from '../../components/DiscoverFilterSheet';
import GenreGrid from '../../components/GenreGrid';
import GlassSurface from '../../components/GlassSurface';
import HeroCarousel from '../../components/HeroCarousel';
import HorizontalMediaList from '../../components/HorizontalMediaList';
import PressableScale from '../../components/PressableScale';
import { useAppTheme } from '../../lib/theme';
import { DiscoverMediaItem, useDiscoverStore } from '../../store/discoverStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

// ─── Debounce Hook ─────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// ─── Animated Segment Control ──────────────────────────────────────────────────

// Real lucide icons — this used to be raw emoji (📺/🎬) in the label
// string, which read as amateurish next to the rest of the app's icon
// language. Reuses the same Tv/Film glyphs as the main bottom tab bar for
// a consistent, premium icon vocabulary.
const SEGMENTS = [
  { value: 'tv' as const, label: 'Shows', Icon: Tv },
  { value: 'movie' as const, label: 'Movies', Icon: Film },
];

function AnimatedSegmentControl({
  value,
  onChange,
}: {
  value: 'tv' | 'movie';
  onChange: (v: 'tv' | 'movie') => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const indicatorX = useSharedValue(0);
  const segmentWidth = (SCREEN_WIDTH - 40) / 2;

  useEffect(() => {
    indicatorX.value = withSpring(value === 'tv' ? 0 : segmentWidth, {
      damping: 18,
      stiffness: 220,
    });
  }, [value]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <View style={[seg.wrapper, { borderColor: c.edgeLight }]}>
      {/* This toggle floats directly over the HeroCarousel backdrop image —
          a translucent wash alone was invisible against a bright photo.
          Same two-layer recipe as LiquidTabBar: blur whatever's behind,
          then a theme tint ON TOP of the blur for real contrast. */}
      <BlurView intensity={70} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.glassFill }]} />
      {/* Sliding indicator — solid fill (not a translucent wash), matching
          the same "black icon/text on solid yellow" active-state language
          already established on the bottom tab bar and main SegmentedControl. */}
      <Animated.View
        style={[seg.indicator, { width: segmentWidth, backgroundColor: c.accentFill }, indicatorStyle]}
      />
      {SEGMENTS.map((seg_item) => {
        const isActive = value === seg_item.value;
        return (
          <PressableScale
            key={seg_item.value}
            style={[seg.tab, { width: segmentWidth }]}
            onPress={() => onChange(seg_item.value)}
          >
            <seg_item.Icon
              color={isActive ? c.onAccent : c.textSecondary}
              size={15}
              strokeWidth={isActive ? 2.5 : 2}
            />
            <Text style={[seg.tabText, { color: c.textSecondary }, isActive && { color: c.onAccent }]}>
              {seg_item.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const seg = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    marginHorizontal: 20,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    position: 'relative',
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: 3,
    left: 3,
    bottom: 3,
    borderRadius: 11,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    zIndex: 1,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

// ─── Pagination footer (Phase K) ───────────────────────────────────────────────
// Shared by both the universal-search grid and the filtered/browse grid —
// both already had `page`/`total_pages` available from the backend but
// only ever fetched page 1, so "some titles only shown" (the fix prompt's
// own phrasing) traced to a genuinely missing load-more, not a TMDB result
// ceiling. A small inline spinner row, not a full-screen loader — the
// existing grid stays on screen while the tail request runs.

function LoadMoreFooter({ visible }: { visible: boolean }) {
  const { theme } = useAppTheme();
  if (!visible) return null;
  return (
    <View style={styles.loadMoreFooter}>
      <ActivityIndicator color={theme.colors.accentInk} />
    </View>
  );
}

// ─── Search Result Card ────────────────────────────────────────────────────────

function SearchResultCard({ item }: { item: DiscoverMediaItem }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const params = {
    title: item.title,
    poster_path: item.poster_path || '',
    vote_average: item.vote_average.toString(),
    backdrop_path: item.backdrop_path || '',
    overview: item.overview || '',
  };
  return (
    <PressableScale
      style={src.card}
      onPress={() => {
        if (item.media_type === 'movie') {
          router.push({ pathname: `/movie/${item.tmdb_id}` as any, params });
        } else {
          router.push({ pathname: `/show/${item.tmdb_id}` as any, params });
        }
      }}
    >
      <View style={[src.poster, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
        <Image
          source={
            item.poster_path
              ? { uri: `${POSTER_BASE_URL}${item.poster_path}` }
              : undefined
          }
          style={src.posterImg}
          contentFit="cover"
          transition={200}
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={src.gradient}
        />
        <View style={src.badge}>
          <Text style={src.badgeText}>
            {item.media_type === 'movie' ? 'MOVIE' : 'SERIES'}
          </Text>
        </View>
        <View style={src.ratingBadge}>
          <Text style={src.ratingText}>★ {item.vote_average.toFixed(1)}</Text>
        </View>
      </View>
      <Text style={[src.title, { color: c.textPrimary }]} numberOfLines={2}>
        {item.title}
      </Text>
      {item.release_date && (
        <Text style={[src.year, { color: c.textTertiary }]}>
          {new Date(item.release_date).getFullYear()}
        </Text>
      )}
    </PressableScale>
  );
}

const CARD_WIDTH = (SCREEN_WIDTH - 48) / 3;

const src = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    gap: 6,
  },
  poster: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.5,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  posterImg: { width: '100%', height: '100%' },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  // Badge scrims sit directly on top of the poster photo (not the app
  // background), so they stay a fixed dark wash in both themes — same
  // reasoning as a photo caption overlay.
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ratingBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  // Gold rating star — pre-existing non-token color, unrelated to light/dark
  // (same precedent as profile/movies.tsx's rating style and its "watched" green).
  ratingText: { color: '#FFD700', fontSize: 9, fontWeight: '800' },
  title: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  year: {
    fontSize: 11,
    fontWeight: '500',
  },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const {
    activeSegment,
    setActiveSegment,
    searchQuery,
    setSearchQuery,
    filterSheetVisible,
    toggleFilterSheet,
    feedData,
    isLoadingFeed,
    feedError,
    fetchFeed,
    searchResults,
    isSearching,
    isLoadingMoreSearch,
    loadMoreSearchResults,
    runSearch,
    clearSearch,
    filteredResults,
    isLoadingFiltered,
    isLoadingMoreFiltered,
    loadMoreFilteredResults,
    filteredError,
    isFilterActive,
    setSelectedGenreId,
    fetchGenreCovers,
  } = useDiscoverStore();
  const filterActive = isFilterActive();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const inputRef = useRef<TextInput>(null);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Debounce the search query — hit API 400ms after user stops typing
  const debouncedQuery = useDebounce(searchQuery, 400);

  const scrollY = useSharedValue(0);
  const searchBarHeight = useSharedValue(0);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Initial feed fetch
  useEffect(() => {
    fetchFeed('tv');
  }, []);

  // Genre Grid cover images — fetched (and cached) per segment
  useEffect(() => {
    fetchGenreCovers(activeSegment);
  }, [activeSegment, fetchGenreCovers]);

  // Run search when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim()) {
      runSearch(debouncedQuery);
    } else if (!debouncedQuery) {
      clearSearch();
    }
  }, [debouncedQuery]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSegmentChange = useCallback(
    (seg: 'tv' | 'movie') => {
      setActiveSegment(seg);
    },
    [setActiveSegment]
  );

  const handleSearchFocus = () => {
    setIsSearchActive(true);
  };

  const handleClearSearch = () => {
    clearSearch();
    setIsSearchActive(false);
    inputRef.current?.blur();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Force re-fetch by temporarily clearing cache
    useDiscoverStore.setState((state) => ({
      feedData: { ...state.feedData, [activeSegment]: null },
    }));
    await fetchFeed(activeSegment);
    setIsRefreshing(false);
  };

  // ── Animated styles ────────────────────────────────────────────────────────

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const headerBlurStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 80], [0, 1], Extrapolation.CLAMP),
  }));

  // ── Render: data ────────────────────────────────────────────────────────────

  const currentFeed = feedData[activeSegment];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      {/* ── Sticky Header ─────────────────────────────────────────────────── */}
      <View style={styles.headerContainer} pointerEvents="box-none">
        {/* Blur background (fades in on scroll) */}
        <Animated.View style={[StyleSheet.absoluteFill, headerBlurStyle]}>
          <BlurView intensity={80} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: c.glassFill }]} />
          <View style={[styles.headerBorder, { backgroundColor: c.hairline }]} />
        </Animated.View>

        <SafeAreaView edges={['top']}>
          {/* Search Row */}
          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchBar,
                { backgroundColor: c.glassFill, borderColor: c.hairline },
                isSearchActive && { borderColor: c.accentInk },
              ]}
            >
              <TextInput
                ref={inputRef}
                style={[styles.searchInput, { color: c.textPrimary }]}
                placeholder="Search shows, movies, actors..."
                placeholderTextColor={c.textTertiary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={handleSearchFocus}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchQuery.length > 0 && (
                <PressableScale onPress={handleClearSearch} hitSlop={8}>
                  <X color={c.textSecondary} size={16} strokeWidth={2.5} />
                </PressableScale>
              )}
            </View>

            {/* Filter Button */}
            {!isSearchActive && (
              <PressableScale
                style={[
                  styles.filterBtn,
                  { backgroundColor: c.glassFill, borderColor: c.hairline },
                  (filterSheetVisible || filterActive) && {
                    backgroundColor: c.accentDim,
                    borderColor: c.accentInk,
                  },
                ]}
                onPress={toggleFilterSheet}
              >
                <SlidersHorizontal
                  color={filterSheetVisible || filterActive ? c.accentInk : c.textSecondary}
                  size={18}
                  strokeWidth={2}
                />
                {/* A filter is applied but the sheet is closed — without
                    this dot there was no way to tell a filter was active
                    once you dismissed the sheet. */}
                {filterActive && !filterSheetVisible && (
                  <View style={[styles.filterBadge, { backgroundColor: c.accentFill }]} />
                )}
              </PressableScale>
            )}

            {/* Cancel button */}
            {isSearchActive && (
              <PressableScale onPress={handleClearSearch} style={styles.cancelBtn}>
                <Text style={[styles.cancelText, { color: c.accentInk }]}>Cancel</Text>
              </PressableScale>
            )}
          </View>

          {/* Segment control (hidden during search) */}
          {!isSearchActive && (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)} style={styles.segmentWrapper}>
              <AnimatedSegmentControl
                value={activeSegment}
                onChange={handleSegmentChange}
              />
            </Animated.View>
          )}
        </SafeAreaView>
      </View>

      {/* ── Body ──────────────────────────────────────────────────────────── */}

      {isSearchActive ? (
        // ── Search Results ─────────────────────────────────────────────────
        <View style={styles.searchResults}>
          {isSearching ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={c.accentInk} />
            </View>
          ) : searchResults.length > 0 ? (
            <FlashList
              data={searchResults}
              keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
              numColumns={3}
              contentContainerStyle={styles.searchGrid}
              renderItem={({ item }) => <SearchResultCard item={item} />}
              onEndReached={loadMoreSearchResults}
              onEndReachedThreshold={0.5}
              ListFooterComponent={<LoadMoreFooter visible={isLoadingMoreSearch} />}
            />
          ) : debouncedQuery.length > 0 ? (
            <View style={styles.centerState}>
              <Text style={[styles.emptyText, { color: c.textTertiary }]}>
                No results for "{debouncedQuery}"
              </Text>
            </View>
          ) : (
            <View style={styles.centerState}>
              <Text style={[styles.hintText, { color: c.textTertiary }]}>Start typing to search...</Text>
            </View>
          )}
        </View>
      ) : filterActive ? (
        // ── Filtered Results (Filter & Sort sheet: genre and/or non-default
        // sort applied) — a flat TMDB-backed grid, same card/layout as
        // universal search, instead of the fixed curated sections. ─────────
        <View style={styles.searchResults}>
          {isLoadingFiltered ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={c.accentInk} />
            </View>
          ) : filteredError ? (
            <View style={styles.errorContainer}>
              <GlassSurface radius={18} style={styles.errorCard}>
                <WifiOff color={c.textTertiary} size={32} strokeWidth={1.5} />
                <Text style={[styles.errorText, { color: c.textSecondary }]}>{filteredError}</Text>
                <PressableScale
                  style={[styles.retryBtn, { backgroundColor: c.accentDim, borderColor: c.accentInk }]}
                  onPress={() => useDiscoverStore.getState().fetchFilteredResults()}
                >
                  <Text style={[styles.retryText, { color: c.accentInk }]}>Retry</Text>
                </PressableScale>
              </GlassSurface>
            </View>
          ) : filteredResults.length > 0 ? (
            <FlashList
              data={filteredResults}
              keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
              numColumns={3}
              contentContainerStyle={styles.searchGrid}
              renderItem={({ item }) => <SearchResultCard item={item} />}
              onEndReached={loadMoreFilteredResults}
              onEndReachedThreshold={0.5}
              ListFooterComponent={<LoadMoreFooter visible={isLoadingMoreFiltered} />}
            />
          ) : (
            <View style={styles.centerState}>
              <Text style={[styles.emptyText, { color: c.textTertiary }]}>
                No results match this filter.
              </Text>
            </View>
          )}
        </View>
      ) : (
        // ── Feed ───────────────────────────────────────────────────────────
        isLoadingFeed && !currentFeed ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={c.accentInk} size="large" />
          </View>
        ) : feedError && !currentFeed ? (
          <View style={styles.errorContainer}>
            <GlassSurface radius={18} style={styles.errorCard}>
              <WifiOff color={c.textTertiary} size={32} strokeWidth={1.5} />
              <Text style={[styles.errorText, { color: c.textSecondary }]}>{feedError}</Text>
              <PressableScale
                style={[styles.retryBtn, { backgroundColor: c.accentDim, borderColor: c.accentInk }]}
                onPress={() => {
                  useDiscoverStore.setState((state) => ({
                    feedData: { ...state.feedData, [activeSegment]: null },
                    feedError: null,
                  }));
                  fetchFeed(activeSegment);
                }}
              >
                <Text style={[styles.retryText, { color: c.accentInk }]}>Retry</Text>
              </PressableScale>
            </GlassSurface>
          </View>
        ) : (
          <Animated.ScrollView
            showsVerticalScrollIndicator={false}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={c.accentInk}
                progressViewOffset={120}
              />
            }
          >
            {/* Hero Carousel */}
            {currentFeed?.hero && currentFeed.hero.length > 0 && (
              <HeroCarousel items={currentFeed.hero} />
            )}

            {/* Sections */}
            <View style={styles.feedContent}>
              {currentFeed?.sections?.map((section) => (
                <HorizontalMediaList
                  key={section.id}
                  title={section.title}
                  items={section.items}
                />
              ))}

              {/* Genre Grid */}
              <GenreGrid activeSegment={activeSegment} onSelectGenre={setSelectedGenreId} />
            </View>
          </Animated.ScrollView>
        )
      )}

      {/* ── Filter Bottom Sheet (rendered above everything) ────────────────── */}
      <DiscoverFilterSheet activeSegment={activeSegment} />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    padding: 0,
  },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  cancelBtn: {
    paddingHorizontal: 4,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  segmentWrapper: {
    paddingBottom: 12,
  },

  // Feed content
  feedContent: {
    flex: 1,
    paddingBottom: 120,
  },
  scrollContent: {
    paddingTop: 130, // clears sticky header (search bar ~52px + segment ~50px + spacing)
  },

  // Search
  searchResults: {
    flex: 1,
    marginTop: 130,
  },
  searchGrid: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 120,
  },
  loadMoreFooter: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  hintText: {
    fontSize: 15,
    fontWeight: '400',
  },

  // Error
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorCard: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 28,
    paddingVertical: 32,
    width: '100%',
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 21,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
