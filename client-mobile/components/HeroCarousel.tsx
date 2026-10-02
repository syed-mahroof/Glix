import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { useWindowDimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import PressableScale from './PressableScale';
import { Pause, Play } from 'lucide-react-native';
import { usePrefersReducedMotion } from '../lib/motion';
import { useScreenActive } from '../lib/useScreenActive';
import { useAppTheme } from '../lib/theme';

const HEIGHT = 450;
// Full-bleed at SCREEN_WIDTH: on a 3x-density phone (iPhone Pro / most
// Android flagships, ~390-430pt wide) that's ~1170-1290 physical pixels —
// w1280 is the correctly-sized TMDB backdrop tier for this, not oversized.
// (A smaller tier here would visibly soften the one image in the app most
// meant to be admired full-screen; left at TMDB's native choice.)
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w1280';

// This component renders entirely over a full-bleed backdrop photo with a
// black gradient scrim (see `gradient`/`content` below) — the same
// "caption overlay on a photo" pattern as SearchResultCard's rating badge.
// That scrim + white text stays fixed dark in both app themes by design
// (legibility over an arbitrary photo, not the app's root background), so
// only the accent token below is pulled from theme — everything else here
// is intentionally theme-invariant.

export interface HeroMedia {
  tmdb_id: number;
  media_type: 'tv' | 'movie';
  title: string;
  backdrop_path: string | null;
  overview: string;
  // Optional — not every caller has these, but movie/[id].tsx and
  // show/[id].tsx both read them for a richer optimistic render (poster +
  // rating visible immediately, not just backdrop/overview). The Discover
  // feed's hero items (DiscoverMediaItem) always have both; forwarded when
  // present rather than left out, so the fallback UI doesn't depend on
  // which entry point the user tapped from.
  poster_path?: string | null;
  vote_average?: number;
}

interface Props {
  items: HeroMedia[];
}

function useAutoPlay(scrollRef: React.RefObject<Animated.ScrollView | null>, itemsCount: number, width: number, enabled: boolean) {
  const [currentIndex, setCurrentIndex] = useState(0);
  React.useEffect(() => {
    if (!enabled || itemsCount < 2) return;
    const timer = setTimeout(() => {
      const next = (currentIndex + 1) % itemsCount;
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
      setCurrentIndex(next);
    }, 5000);
    return () => clearTimeout(timer);
  }, [itemsCount, currentIndex, width, enabled, scrollRef]);
  React.useEffect(() => {
    setCurrentIndex(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [itemsCount, width, scrollRef]);
  return setCurrentIndex;
}

// Bug fix (2026-08-07): this body used to live inline inside HeroCarousel's
// `items.map(...)`, calling useAnimatedStyle() once per item — a
// Rules-of-Hooks violation (the number of hooks HeroCarousel itself calls
// changed whenever items.length did, e.g. the Discover feed hero
// refreshing from a persisted snapshot to a server response), which throws
// "Rendered more/fewer hooks than during the previous render" and, short of
// throwing, forces every item's shared-value subscription to be torn down
// and rebuilt on every render regardless. Extracting one hook call per
// component instance is the actual fix, not just a style preference —
// React tracks hook identity per component instance/key here, so
// items.length changing just mounts/unmounts whole HeroSlide instances.
interface HeroSlideProps {
  item: HeroMedia;
  index: number;
  scrollX: SharedValue<number>;
  onPress: (item: HeroMedia) => void;
  width: number;
  height: number;
  reducedMotion: boolean;
}

const HeroSlide = React.memo(function HeroSlide({ item, index, scrollX, onPress, width, height, reducedMotion }: HeroSlideProps) {
  const animatedStyle = useAnimatedStyle(() => {
    if (reducedMotion) return { transform: [{ translateX: 0 }] };
    const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
    const translateX = interpolate(
      scrollX.value,
      inputRange,
      [width * 0.4, 0, -width * 0.4],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateX }],
    };
  });

  return (
    <View style={[styles.slide, { width, height }]}>
      <Animated.View style={[styles.imageContainer, { width, height }, animatedStyle]}>
        <Image
          source={item.backdrop_path ? { uri: `${POSTER_BASE_URL}${item.backdrop_path}` } : undefined}
          recyclingKey={`${item.media_type}-${item.tmdb_id}`}
          style={styles.image}
          contentFit="cover"
          transition={reducedMotion ? 0 : 200}
          cachePolicy="memory-disk"
        />
      </Animated.View>

      {/* Gradient Overlay */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.95)', '#000000']}
        locations={[0, 0.4, 0.8, 1]}
        style={styles.gradient}
      />

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.media_type === 'movie' ? 'MOVIE' : 'SERIES'}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.overview} numberOfLines={2}>
          {item.overview}
        </Text>

        <PressableScale accessibilityRole="button" accessibilityLabel={`View ${item.title}`} style={styles.btn} onPress={() => onPress(item)}>
          <Text style={styles.btnText}>View Details</Text>
        </PressableScale>
      </View>
    </View>
  );
});

interface HeroDotProps {
  index: number;
  scrollX: SharedValue<number>;
  accentFill: string;
  pageWidth: number;
}

const HeroDot = React.memo(function HeroDot({ index, scrollX, accentFill, pageWidth }: HeroDotProps) {
  const dotStyle = useAnimatedStyle(() => {
    const inputRange = [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth];
    const width = interpolate(scrollX.value, inputRange, [8, 20, 8], Extrapolation.CLAMP);
    const opacity = interpolate(scrollX.value, inputRange, [0.3, 1, 0.3], Extrapolation.CLAMP);
    const isActive =
      scrollX.value >= index * pageWidth - pageWidth / 2 &&
      scrollX.value <= index * pageWidth + pageWidth / 2;
    return {
      width,
      opacity,
      backgroundColor: isActive ? accentFill : 'rgba(255,255,255,0.8)',
    };
  });
  return <Animated.View style={[styles.dot, dotStyle]} />;
});

function HeroCarousel({ items }: Props) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const accentFill = theme.colors.accentFill;
  const scrollX = useSharedValue(0);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const screenActive = useScreenActive();
  const reducedMotion = usePrefersReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const height = HEIGHT + Math.max(0, fontScale - 1) * 120;
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const setCurrentIndex = useAutoPlay(scrollRef, items.length, width, screenActive && !reducedMotion && !paused && !dragging);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
    onMomentumEnd: (event) => {
      runOnJS(setCurrentIndex)(Math.round(event.contentOffset.x / width));
    },
  });

  const handlePress = (item: HeroMedia) => {
    const params = {
      title: item.title,
      backdrop_path: item.backdrop_path || '',
      overview: item.overview,
      poster_path: item.poster_path || '',
      vote_average: (item.vote_average ?? 0).toString(),
    };
    if (item.media_type === 'movie') {
      router.push({ pathname: `/movie/${item.tmdb_id}` as any, params });
    } else {
      router.push({ pathname: `/show/${item.tmdb_id}` as any, params });
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <View style={[styles.container, { width, height }]}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => setDragging(true)}
        onScrollEndDrag={() => setDragging(false)}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {items.map((item, index) => (
          <HeroSlide
            key={`${item.media_type}-${item.tmdb_id}`}
            item={item}
            index={index}
            scrollX={scrollX}
            onPress={handlePress}
            width={width}
            height={height}
            reducedMotion={reducedMotion}
          />
        ))}
      </Animated.ScrollView>

      {!reducedMotion && items.length > 1 && <PressableScale accessibilityRole="button" accessibilityLabel={paused ? 'Resume featured titles' : 'Pause featured titles'} onPress={() => setPaused((value) => !value)} style={styles.playback}>
        {paused ? <Play size={16} color="#fff" /> : <Pause size={16} color="#fff" />}
      </PressableScale>}
      {/* Pagination dots */}
      <View style={styles.pagination}>
        {items.map((_, i) => (
          <HeroDot key={i} index={i} scrollX={scrollX} accentFill={accentFill} pageWidth={width} />
        ))}
      </View>
    </View>
  );
}

export default React.memo(HeroCarousel);

const styles = StyleSheet.create({
  playback: { position: 'absolute', right: 12, bottom: 0, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  container: {
    height: HEIGHT,
  },
  slide: {
    height: HEIGHT,
    overflow: 'hidden',
  },
  imageContainer: {
    height: HEIGHT,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
    top: '30%',
  },
  content: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    gap: 12,
    alignItems: 'flex-start',
  },
  // Sits directly on the backdrop photo (a caption badge, not app chrome) —
  // stays a fixed dark glass wash in both themes, same as SearchResultCard's
  // rating badge.
  badge: {
    backgroundColor: 'rgba(30, 30, 30, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 38,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  overview: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  btn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 24,
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pagination: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
