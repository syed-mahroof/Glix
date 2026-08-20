// client-mobile/app/(tabs)/discover.tsx
// Glix V2 — Discover Hub (Phase 4 Full Rebuild)
// Universal search + segmented TV/Movie feed + filter bottom sheet.

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
  ViewStyle,
} from 'react-native';
import Animated, {
  AnimatedStyle,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';

import DiscoverFilterSheet from '../../components/DiscoverFilterSheet';
import GenreGrid from '../../components/GenreGrid';
import GlassBlur from '../../components/GlassBlur';
import GlassSurface from '../../components/GlassSurface';
import HeroCarousel from '../../components/HeroCarousel';
import HorizontalMediaList from '../../components/HorizontalMediaList';
import PressableScale from '../../components/PressableScale';
import { useAppTheme } from '../../lib/theme';
import { useColdStartHint } from '../../lib/warmup';
import {
  ActiveSegment,
  DiscoverFeedResponse,
  DiscoverMediaItem,
  ForYouItem,
  useDiscoverStore,
} from '../../store/discoverStore';

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
      <GlassBlur intensity={70} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
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
//
// Bug fix (2026-08-21, "empty gaps in the filtered Discover grid"): this card
// used to be a fixed-pixel-width column (CARD_WIDTH = (SCREEN_WIDTH-48)/3)
// with a variable-height caption underneath (title 1-OR-2 lines, an optional
// year row) sitting inside a `numColumns={3}` FlashList. FlashList v2's own
// types document that grid cells must all be the same height — masonry
// layouts aren't supported — so a variable-height cell here was always going
// to eventually misalign into visible holes once cells fell out of a neat
// multiple-of-3 pattern (which unfiltered/filtered pagination guarantees
// will happen; see discoverStore's loadMore fixes). CARD_WIDTH's own
// `-48` also didn't match this screen's real `paddingHorizontal: 16`
// container (`searchGrid` below) — an independent few-pixel misalignment on
// top of the height one.
//
// Fixed by matching the pattern every OTHER 3-column grid in this app
// already uses successfully (components/MoviePosterCard.tsx, rendered by
// Movies Hub / Profile's My Movies grid): let FlashList's own column flex
// sizing set the width (`wrap: { flex: 1 }`, no computed pixel width to
// drift out of sync with the container), size the poster by `aspectRatio`
// instead of a computed height, and make the caption underneath a FIXED
// height regardless of content — a reserved 2-line title box (`minHeight`)
// so a 1-line title doesn't leave its cell shorter than a 2-line neighbor,
// and the year line always rendered (as a zero-width-space when there's no
// release_date) so its absence doesn't do the same thing. Every cell is now
// structurally identical height, which is what FlashList v2's grid actually
// requires.
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
    <View style={src.wrap}>
      <PressableScale
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
            recyclingKey={`${item.media_type}-${item.tmdb_id}`}
            cachePolicy="memory-disk"
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
      </PressableScale>
      <Text style={[src.title, { color: c.textPrimary }]} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={[src.year, { color: c.textTertiary }]} numberOfLines={1}>
        {item.release_date ? new Date(item.release_date).getFullYear() : '​'}
      </Text>
    </View>
  );
}

const src = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: 6,
  },
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
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
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    // Reserved 2-line box (see this card's header comment) — a 1-line title
    // still occupies the same height as a 2-line one, so every cell in the
    // grid is the same total height regardless of content.
    minHeight: 32,
  },
  year: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
});

// ─── Search Header (Phase 83 perf) ─────────────────────────────────────────────
// Split out of DiscoverScreen's render so a searchQuery keystroke — which
// only this subtree needs to reflect — doesn't force React to re-diff
// DiscoverFeedBody's sibling subtree too. Not memoized: it's supposed to
// re-render on every keystroke, that's what shows the typed text.

interface DiscoverSearchHeaderProps {
  headerBlurStyle: AnimatedStyle<ViewStyle>;
  inputRef: React.RefObject<TextInput | null>;
  isSearchActive: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchFocus: () => void;
  onClearSearch: () => void;
  filterSheetVisible: boolean;
  filterActive: boolean;
  onToggleFilterSheet: () => void;
  activeSegment: ActiveSegment;
  onSegmentChange: (segment: ActiveSegment) => void;
  /** Device status-bar inset (`useSafeAreaInsets().top`) — the header is
   *  `position: 'absolute'` at the screen root (see `headerContainer` below)
   *  so it can float over the full-bleed hero, which means it's no longer
   *  inside anything that reserves the status-bar area for it. Padding by
   *  this value keeps the search bar clear of the status bar without
   *  clipping the hero behind it — a `SafeAreaView` here would do the same
   *  padding but ALSO paint over the hero with the screen background color,
   *  which is exactly the opaque strip a full-bleed hero is meant to not have. */
  topInset: number;
  /** Reports the header's own rendered height (status bar inset + search
   *  row + segment control) once measured, so the screen can size the
   *  search/filtered result grids' top clearance to the header's REAL
   *  height instead of a hardcoded guess — see this screen's own
   *  `headerHeight` state for the full story. */
  onHeightChange: (height: number) => void;
}

function DiscoverSearchHeader({
  headerBlurStyle,
  topInset,
  onHeightChange,
  inputRef,
  isSearchActive,
  searchQuery,
  onSearchChange,
  onSearchFocus,
  onClearSearch,
  filterSheetVisible,
  filterActive,
  onToggleFilterSheet,
  activeSegment,
  onSegmentChange,
}: DiscoverSearchHeaderProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View
      style={styles.headerContainer}
      pointerEvents="box-none"
      onLayout={(e) => onHeightChange(e.nativeEvent.layout.height)}
    >
      {/* Blur background (fades in on scroll) */}
      <Animated.View style={[StyleSheet.absoluteFill, headerBlurStyle]}>
        <GlassBlur intensity={80} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.glassFill }]} />
        <View style={[styles.headerBorder, { backgroundColor: c.hairline }]} />
      </Animated.View>

      {/* Full-bleed hero (Discover redesign): this header floats at the
          screen's top edge, `position: 'absolute'`, with the hero rendering
          full-bleed behind it (see DiscoverScreen's `scrollContent`, which no
          longer reserves a paddingTop gap for this header). A `SafeAreaView`
          here would paint the status-bar strip with the screen background
          color — exactly the opaque band a full-bleed hero shouldn't have —
          so this is a plain View padded by the real inset instead. */}
      <View style={{ paddingTop: topInset }}>
        {/* Search Row */}
        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchBar,
              { borderColor: c.hairline },
              isSearchActive && { borderColor: c.accentInk },
            ]}
          >
            {/* Glassmorphic fill (Discover redesign): a real blur, not just
                a translucent color — at scroll position 0 the header's own
                blur layer above hasn't faded in yet, so this pill floats
                directly over the hero photo with nothing else behind it.
                GlassBlur (not a raw BlurView) because Android's BlurView
                doesn't actually blur without a native config this app
                doesn't set — see GlassBlur.tsx. glassFillStrong, not
                glassFill: this sits over the hero's own busy photo content,
                same "floats over image-heavy content" case that token's own
                doc comment names. */}
            <GlassBlur
              intensity={80}
              tint={theme.blurTint}
              style={[StyleSheet.absoluteFill, styles.pillClip]}
            />
            <View
              style={[StyleSheet.absoluteFill, styles.pillClip, { backgroundColor: c.glassFillStrong }]}
            />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, { color: c.textPrimary }]}
              placeholder="Search shows, movies, actors..."
              placeholderTextColor={c.textTertiary}
              value={searchQuery}
              onChangeText={onSearchChange}
              onFocus={onSearchFocus}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <PressableScale
                onPress={onClearSearch}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X color={c.textSecondary} size={16} strokeWidth={2.5} />
              </PressableScale>
            )}
          </View>

          {/* Filter Button */}
          {!isSearchActive && (
            <PressableScale
              style={[
                styles.filterBtn,
                { borderColor: c.hairline },
                (filterSheetVisible || filterActive) && { borderColor: c.accentInk },
              ]}
              onPress={onToggleFilterSheet}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Filter and sort"
              accessibilityState={{ selected: filterSheetVisible || filterActive }}
            >
              <GlassBlur
                intensity={80}
                tint={theme.blurTint}
                style={[StyleSheet.absoluteFill, styles.pillClip]}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  styles.pillClip,
                  {
                    backgroundColor:
                      filterSheetVisible || filterActive ? c.accentDim : c.glassFillStrong,
                  },
                ]}
              />
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
            <PressableScale onPress={onClearSearch} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: c.accentInk }]}>Cancel</Text>
            </PressableScale>
          )}
        </View>

        {/* Segment control (hidden during search) */}
        {!isSearchActive && (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)} style={styles.segmentWrapper}>
            <AnimatedSegmentControl value={activeSegment} onChange={onSegmentChange} />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

// ─── Feed Body (Phase 83 perf) ─────────────────────────────────────────────────
// Only mounted when neither search nor a filter is active. Memoized because
// its props (this segment's feed/For You data, isLoadingFeed, feedError)
// are stable across everything DiscoverSearchHeader re-renders for — a
// keystroke, opening the filter sheet — so the memo actually holds and this
// subtree (HeroCarousel + N HorizontalMediaLists + GenreGrid, each already
// memoized on its own props too) skips re-rendering along with it.
// handleRefresh/handleRetryFeed are passed down as useCallback-stable
// references from DiscoverScreen specifically so this memo isn't defeated
// by a fresh closure identity every render.

// C13 stale-while-revalidate: a persisted feed snapshot older than this is
// shown immediately (never a blank/spinner cold start) but flagged as
// possibly out of date while the background revalidation it always gets
// on mount (discoverStore's hasFetchedFeed session guard) is still in
// flight — rather than silently presenting week-old "Trending" as current.
const STALE_FEED_THRESHOLD_MS = 30 * 60 * 1000;

interface DiscoverFeedBodyProps {
  activeSegment: ActiveSegment;
  currentFeed: DiscoverFeedResponse | null;
  feedFetchedAt: number | null;
  forYouItems: ForYouItem[];
  isLoadingFeed: boolean;
  feedError: string | null;
  isWakingBackend: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  scrollHandler: ReturnType<typeof useAnimatedScrollHandler>;
  onSelectGenre: (genreId: number) => void;
  onRetry: () => void;
  /** Measured height of the floating header (see DiscoverScreen's
   *  `headerHeight` state) — a plain number, not a ref/animated value, so
   *  this memo boundary still holds for everything else. Used only to
   *  offset the pull-to-refresh spinner below the header; the hero itself
   *  intentionally renders full-bleed BEHIND the header, unaffected by this
   *  value. */
  headerHeight: number;
}

function DiscoverFeedBodyComponent({
  activeSegment,
  currentFeed,
  feedFetchedAt,
  forYouItems,
  isLoadingFeed,
  feedError,
  isWakingBackend,
  isRefreshing,
  onRefresh,
  scrollHandler,
  onSelectGenre,
  onRetry,
  headerHeight,
}: DiscoverFeedBodyProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  const isRevalidatingStaleSnapshot =
    isLoadingFeed &&
    currentFeed !== null &&
    feedFetchedAt !== null &&
    Date.now() - feedFetchedAt > STALE_FEED_THRESHOLD_MS;

  if (isLoadingFeed && !currentFeed) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={c.accentInk} size="large" />
        {isWakingBackend && (
          <Text style={[styles.wakingText, { color: c.textTertiary }]}>
            Waking up the server — this can take up to a minute.
          </Text>
        )}
      </View>
    );
  }

  if (feedError && !currentFeed) {
    return (
      <View style={styles.errorContainer}>
        <GlassSurface radius={18} style={styles.errorCard}>
          <WifiOff color={c.textTertiary} size={32} strokeWidth={1.5} />
          <Text style={[styles.errorText, { color: c.textSecondary }]}>{feedError}</Text>
          <PressableScale
            style={[styles.retryBtn, { backgroundColor: c.accentDim, borderColor: c.accentInk }]}
            onPress={onRetry}
          >
            <Text style={[styles.retryText, { color: c.accentInk }]}>Retry</Text>
          </PressableScale>
        </GlassSurface>
      </View>
    );
  }

  return (
    <Animated.ScrollView
      showsVerticalScrollIndicator={false}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={c.accentInk}
          // Was a hardcoded 120 tuned to the old paddingTop:130 header
          // clearance — the hero is now full-bleed behind the header
          // (scrollContent no longer reserves that gap), so the pull spinner
          // needs the header's real measured height instead, or it renders
          // under the floating header instead of below it.
          progressViewOffset={headerHeight}
        />
      }
    >
      {isRevalidatingStaleSnapshot && (
        <View style={styles.updatingBadge}>
          <ActivityIndicator size="small" color={c.textTertiary} />
          <Text style={[styles.updatingText, { color: c.textTertiary }]}>Updating…</Text>
        </View>
      )}

      {/* Hero Carousel */}
      {currentFeed?.hero && currentFeed.hero.length > 0 && (
        <HeroCarousel items={currentFeed.hero} />
      )}

      {/* For You — cross-library recommendations, scoped to the active
          tv/movie segment (2026-07-31: previously mixed both media types
          into one shared list regardless of segment). */}
      <HorizontalMediaList title="For You" items={forYouItems} />

      {/* Sections */}
      <View style={styles.feedContent}>
        {currentFeed?.sections?.map((section) => (
          <HorizontalMediaList key={section.id} title={section.title} items={section.items} />
        ))}

        {/* Genre Grid */}
        <GenreGrid activeSegment={activeSegment} onSelectGenre={onSelectGenre} />
      </View>
    </Animated.ScrollView>
  );
}

const DiscoverFeedBody = React.memo(DiscoverFeedBodyComponent);

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  // House rule (Phase 83 perf): one atomic selector per STATE field below
  // (so a change to one field doesn't re-render for a change to another),
  // a single getState() destructure for ACTIONS (their identities never
  // change, so individually subscribing to all 11 of them — the previous
  // shape — bought nothing but 11 dead subscriptions), and no store getter
  // called mid-render. isFilterActive() used to be called directly here,
  // which reads via get() and therefore never subscribes to anything —
  // filterActive only actually updated when some unrelated field's own
  // subscription happened to force a re-render along with it. Replaced
  // with a real derived-boolean selector below; Object.is gives correct
  // memoization for a primitive return with no useShallow needed.
  const activeSegment = useDiscoverStore((s) => s.activeSegment);
  const searchQuery = useDiscoverStore((s) => s.searchQuery);
  const filterSheetVisible = useDiscoverStore((s) => s.filterSheetVisible);
  const feedData = useDiscoverStore((s) => s.feedData);
  const feedFetchedAt = useDiscoverStore((s) => s.feedFetchedAt);
  const isLoadingFeed = useDiscoverStore((s) => s.isLoadingFeed);
  const feedError = useDiscoverStore((s) => s.feedError);
  const searchResults = useDiscoverStore((s) => s.searchResults);
  const isSearching = useDiscoverStore((s) => s.isSearching);
  const isLoadingMoreSearch = useDiscoverStore((s) => s.isLoadingMoreSearch);
  const filteredResults = useDiscoverStore((s) => s.filteredResults);
  const isLoadingFiltered = useDiscoverStore((s) => s.isLoadingFiltered);
  const isLoadingMoreFiltered = useDiscoverStore((s) => s.isLoadingMoreFiltered);
  const filteredError = useDiscoverStore((s) => s.filteredError);
  const forYou = useDiscoverStore((s) => s.forYou);
  const filterActive = useDiscoverStore(
    (s) =>
      s.selectedGenreId !== null ||
      s.sortOrder !== 'trending' ||
      s.selectedLanguage !== null ||
      s.animeOnly
  );

  const {
    setActiveSegment,
    setSearchQuery,
    toggleFilterSheet,
    fetchFeed,
    loadMoreSearchResults,
    runSearch,
    clearSearch,
    loadMoreFilteredResults,
    setSelectedGenreId,
    fetchGenreCovers,
    fetchForYou,
  } = useDiscoverStore.getState();

  const { theme } = useAppTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();

  // Discover has no persisted fallback (discoverStore.ts is in-memory only)
  // — unlike Shows/Movies Hub, which paint real content from AsyncStorage
  // regardless of the network, this screen has nothing to show until the
  // initial feed fetch below actually resolves. See lib/warmup.ts's
  // useColdStartHint for why that matters after a fresh Render redeploy.
  const isWakingBackend = useColdStartHint(isLoadingFeed && !feedData[activeSegment]);

  const inputRef = useRef<TextInput>(null);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Full-bleed hero redesign: the search/filtered result grids (unlike the
  // hero feed) need to clear the floating header's REAL height, which
  // varies by device (status bar inset) and isn't knowable until the header
  // actually lays out. Seeded to a close-enough estimate
  // (insets.top + search row ~52px + segment row ~50px + spacing ~12px) so
  // the very first frame doesn't render with a visible jump once the header
  // reports its real measured height via onLayout.
  const [headerHeight, setHeaderHeight] = useState(() => insets.top + 114);

  // Debounce the search query — hit API 400ms after user stops typing
  const debouncedQuery = useDebounce(searchQuery, 400);

  const scrollY = useSharedValue(0);
  const searchBarHeight = useSharedValue(0);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Initial feed/ForYou/genre-covers fetch, for whichever segment is
  // actually active when this screen first mounts — not hardcoded to 'tv'.
  // discoverStore is in-memory only (no persistence), so activeSegment is
  // 'tv' on a cold app launch, but a remount while it's already 'movie'
  // (e.g. detachInactiveScreens reclaiming this screen under memory
  // pressure, then Discover getting focused again) used to still kick off
  // a 'tv' fetch nobody asked for while the segment actually on screen got
  // nothing. Captured once via ref — every *subsequent* segment switch
  // already goes through setActiveSegment (discoverStore.ts), which fetches
  // all three itself; this effect only needs to cover the very first mount.
  const initialSegmentRef = useRef(activeSegment);
  useEffect(() => {
    const segment = initialSegmentRef.current;
    fetchFeed(segment);
    fetchForYou(segment);
    fetchGenreCovers(segment);
  }, []);

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

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Force re-fetch by temporarily clearing cache
    useDiscoverStore.setState((state) => ({
      feedData: { ...state.feedData, [activeSegment]: null },
    }));
    await fetchFeed(activeSegment);
    setIsRefreshing(false);
  }, [activeSegment, fetchFeed]);

  // Stable identity (not an inline arrow in the JSX below) so DiscoverFeedBody's
  // React.memo actually holds when the parent re-renders for an unrelated
  // reason (e.g. the filter sheet opening over the feed).
  const handleRetryFeed = useCallback(() => {
    useDiscoverStore.setState((state) => ({
      feedData: { ...state.feedData, [activeSegment]: null },
      feedError: null,
    }));
    fetchFeed(activeSegment);
  }, [activeSegment, fetchFeed]);

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
      <DiscoverSearchHeader
        headerBlurStyle={headerBlurStyle}
        inputRef={inputRef}
        isSearchActive={isSearchActive}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchFocus={handleSearchFocus}
        onClearSearch={handleClearSearch}
        filterSheetVisible={filterSheetVisible}
        filterActive={filterActive}
        onToggleFilterSheet={toggleFilterSheet}
        activeSegment={activeSegment}
        onSegmentChange={handleSegmentChange}
        topInset={insets.top}
        onHeightChange={setHeaderHeight}
      />

      {/* ── Body ──────────────────────────────────────────────────────────── */}

      {isSearchActive ? (
        // ── Search Results ─────────────────────────────────────────────────
        <View style={[styles.searchResults, { marginTop: headerHeight }]}>
          {isSearching ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={c.accentInk} />
            </View>
          ) : searchResults.length > 0 ? (
            <FlashList
              // Distinct key from the filtered-results grid below: both
              // render at the same JSX position across an isSearchActive/
              // filterActive branch swap, so without this React reconciles
              // them as ONE FlashList instance being handed new data rather
              // than a fresh mount — see this screen's own SearchResultCard
              // comment for the layout-cache-carryover class of bug that
              // pattern risks.
              key="search-grid"
              data={searchResults}
              keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
              getItemType={() => 'card'}
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
        <View style={[styles.searchResults, { marginTop: headerHeight }]}>
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
              key="filtered-grid"
              data={filteredResults}
              keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
              getItemType={() => 'card'}
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
        <DiscoverFeedBody
          activeSegment={activeSegment}
          currentFeed={currentFeed}
          feedFetchedAt={feedFetchedAt[activeSegment]}
          forYouItems={forYou[activeSegment]}
          isLoadingFeed={isLoadingFeed}
          feedError={feedError}
          isWakingBackend={isWakingBackend}
          isRefreshing={isRefreshing}
          onRefresh={handleRefresh}
          scrollHandler={scrollHandler}
          onSelectGenre={setSelectedGenreId}
          onRetry={handleRetryFeed}
          headerHeight={headerHeight}
        />
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
    gap: 12,
  },
  wakingText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  updatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  updatingText: {
    fontSize: 12,
    fontWeight: '600',
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
    overflow: 'hidden',
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
    overflow: 'hidden',
  },
  // Shared by the blur+tint layers inside searchBar/filterBtn — matches
  // both containers' own borderRadius as a belt-and-suspenders clip
  // (parent `overflow: 'hidden'` should be enough, but Android has had
  // corner-clipping quirks with absolutely-positioned children before).
  pillClip: {
    borderRadius: 14,
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
    // Full-bleed hero redesign: was 130 (a hardcoded guess at the sticky
    // header's height) to keep feed content clear of the floating header.
    // The hero is now DELIBERATELY meant to render behind the header
    // instead — HeroCarousel starts at y=0, full width, with the header
    // floating on top of it via its own `position: 'absolute'` + zIndex.
    // Content that comes after the hero (For You, sections, genre grid)
    // still needs to clear the header, but the hero itself provides that
    // clearance visually — its own gradient scrim reaches well past any
    // header height, so no separate paddingTop is needed here.
    paddingTop: 0,
  },

  // Search / filtered results — flat lists with no hero behind them, so
  // (unlike scrollContent above) these DO need to clear the floating
  // header's real height. marginTop is applied inline at each call site
  // from `headerHeight` state (measured via the header's own onLayout —
  // see DiscoverScreen) rather than a hardcoded guess here.
  searchResults: {
    flex: 1,
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
