import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEIGHT = 450;
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

// Custom hook to run interval manually, bypassing the lack of FlashList autoScroll natively
function useAutoPlay(scrollRef: React.RefObject<Animated.ScrollView>, itemsCount: number) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev + 1 >= itemsCount ? 0 : prev + 1;
        scrollRef.current?.scrollTo({ x: next * SCREEN_WIDTH, animated: true });
        return next;
      });
    }, 5000);
  };

  React.useEffect(() => {
    if (itemsCount > 0) startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [itemsCount]);

  return { currentIndex, setCurrentIndex, startTimer };
}

export default function HeroCarousel({ items }: Props) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const accentFill = theme.colors.accentFill;
  const scrollX = useSharedValue(0);
  const scrollRef = useRef<Animated.ScrollView>(null);

  const { setCurrentIndex, startTimer } = useAutoPlay(scrollRef, items.length);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
    onMomentumEnd: (event) => {
      runOnJS(setCurrentIndex)(Math.round(event.contentOffset.x / SCREEN_WIDTH));
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
    <View style={styles.container}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onTouchStart={() => {
          // Pause autoplay on touch? Can get complex. Usually just fine to let user scroll.
        }}
      >
        {items.map((item, index) => {
          // Calculate parallax transformation for each item
          const animatedStyle = useAnimatedStyle(() => {
            const inputRange = [
              (index - 1) * SCREEN_WIDTH,
              index * SCREEN_WIDTH,
              (index + 1) * SCREEN_WIDTH,
            ];
            const translateX = interpolate(
              scrollX.value,
              inputRange,
              [SCREEN_WIDTH * 0.4, 0, -SCREEN_WIDTH * 0.4],
              Extrapolation.CLAMP
            );
            return {
              transform: [{ translateX }],
            };
          });

          return (
            <View style={styles.slide} key={`${item.media_type}-${item.tmdb_id}`}>
              <Animated.View style={[styles.imageContainer, animatedStyle]}>
                <Image
                  source={{ uri: `${POSTER_BASE_URL}${item.backdrop_path}` }}
                  style={styles.image}
                  contentFit="cover"
                  transition={200}
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
                  <Text style={styles.badgeText}>
                    {item.media_type === 'movie' ? 'MOVIE' : 'SERIES'}
                  </Text>
                </View>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.overview} numberOfLines={2}>
                  {item.overview}
                </Text>

                <PressableScale
                  style={styles.btn}
                  onPress={() => handlePress(item)}
                >
                  <Text style={styles.btnText}>View Details</Text>
                </PressableScale>
              </View>
            </View>
          );
        })}
      </Animated.ScrollView>

      {/* Pagination dots */}
      <View style={styles.pagination}>
        {items.map((_, i) => {
          const dotStyle = useAnimatedStyle(() => {
            const inputRange = [
              (i - 1) * SCREEN_WIDTH,
              i * SCREEN_WIDTH,
              (i + 1) * SCREEN_WIDTH,
            ];
            const width = interpolate(
              scrollX.value,
              inputRange,
              [8, 20, 8],
              Extrapolation.CLAMP
            );
            const opacity = interpolate(
              scrollX.value,
              inputRange,
              [0.3, 1, 0.3],
              Extrapolation.CLAMP
            );
            const backgroundColor = interpolate(
              scrollX.value,
              inputRange,
              [0, 1, 0],
              Extrapolation.CLAMP
            ) === 1 ? accentFill : 'rgba(255,255,255,0.8)';

            return {
              width,
              opacity,
              backgroundColor: scrollX.value >= i * SCREEN_WIDTH - SCREEN_WIDTH/2 && scrollX.value <= i * SCREEN_WIDTH + SCREEN_WIDTH/2 ? accentFill : 'rgba(255,255,255,0.8)',
            };
          });
          return <Animated.View key={i} style={[styles.dot, dotStyle]} />;
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: HEIGHT,
    width: SCREEN_WIDTH,
  },
  slide: {
    width: SCREEN_WIDTH,
    height: HEIGHT,
    overflow: 'hidden',
  },
  imageContainer: {
    width: SCREEN_WIDTH,
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
