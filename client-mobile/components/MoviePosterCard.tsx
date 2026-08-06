// client-mobile/components/MoviePosterCard.tsx
// Large poster-centric grid card for Movies Hub / Profile > My Movies Grid
// View — the movie counterpart to `ShowPosterCard.tsx`. Same photo-caption
// overlay rules: badges painted on the poster stay a fixed dark-wash/white
// treatment (or accentFill/onAccent for the watched checkmark, which is
// legible over any ground by design), while text below the poster reads
// from theme tokens like every other themed surface.

import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { isReduceMotionEnabled } from '../lib/motion';
import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

// Matches MovieRow's COLLAPSE_DELAY (components/MovieRow.tsx). Unlike
// ShowPosterCard (which advances IN PLACE to the show's next episode),
// marking a movie watched moves it between watch_next/watched buckets
// (watchStore.ts's toggleMovieWatchState) — under the active filter this
// card is removed from `rows` entirely, same as MovieRow's case. So this
// card gets an EXIT, not an advance: confirm the tick, then fade+shrink the
// whole card, then commit (removing it from the list) as the fade finishes.
const EXIT_DELAY = 420;
// A grid cell can't collapse its height without breaking the row (unlike
// MovieRow, which shrinks rowHeight to 0) — FlashList measures cells, and
// animating a layout property thrashes it. Opacity + scale only.
const EXIT_DURATION = 240;

export interface MoviePosterCardProps {
  movieId: number;
  title: string;
  posterPath: string | null;
  /** e.g. "1h 42m · Action" */
  subtitle?: string;
  /** e.g. "★ 7.4" — rendered as a photo-caption overlay in the top-left. */
  ratingBadge?: string;
  checkmark?: {
    isWatched: boolean;
    disabled?: boolean;
    onPress: () => void;
  };
}

// Not memoized before (Phase 74 perf pass) — same reasoning as
// ShowPosterCard/ShowRow.
function MoviePosterCardComponent({
  movieId,
  title,
  posterPath,
  subtitle,
  ratingBadge,
  checkmark,
}: MoviePosterCardProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const isAnimating = useRef(false);
  const isMounted = useRef(true);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever the reset effect below actually resets — lets a
  // deferred commit tell whether this exact instance still represents the
  // movie that was tapped (FlashList can recycle it to a different movie
  // while the 420ms timer is pending).
  const generation = useRef(0);

  const fillProgress = useSharedValue(checkmark?.isWatched ? 1 : 0);
  const tickScale = useSharedValue(checkmark?.isWatched ? 1 : 0);
  const checkBounce = useSharedValue(1);
  // Card exit — opacity + transform ONLY, never a layout property (width/
  // height/margin), so FlashList's measured cell size never changes
  // mid-animation.
  const cardOpacity = useSharedValue(1);
  const cardScale = useSharedValue(1);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  // movieId is a genuinely stable card identity here (unlike
  // ShowPosterCard, where the equivalent id is the EPISODE and legitimately
  // changes on the card's own commit): a movie appears at most once per
  // bucket and this card's only mount site (movies.tsx) keys by
  // String(item.movie.tmdb_id), so this only fires for a real FlashList
  // recycle or the store changing this movie's watched state from
  // elsewhere. Restoring cardOpacity/cardScale here is load-bearing —
  // without it, a cell recycled mid-exit would render its next movie
  // invisible.
  useEffect(() => {
    generation.current += 1;
    isAnimating.current = false;
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    fillProgress.value = checkmark?.isWatched ? 1 : 0;
    tickScale.value = checkmark?.isWatched ? 1 : 0;
    checkBounce.value = 1;
    cardOpacity.value = 1;
    cardScale.value = 1;
  }, [movieId, checkmark?.isWatched, fillProgress, tickScale, checkBounce, cardOpacity, cardScale]);

  const endExit = useCallback(() => {
    isAnimating.current = false;
  }, []);

  const handleCheckPress = useCallback(() => {
    if (!checkmark) return;
    if (isAnimating.current) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (checkmark.isWatched) {
      // Un-watching (WATCHED / LAST_WATCHED filters): reverse the fill and
      // commit immediately — same asymmetry MovieRow already has, only the
      // marking direction gets an exit.
      fillProgress.value = withSpring(0, { damping: 16, stiffness: 200 });
      tickScale.value = withTiming(0, { duration: 160 });
      checkBounce.value = withSequence(
        withSpring(0.88, { damping: 12, stiffness: 300 }),
        withSpring(1.0, { damping: 14, stiffness: 240 })
      );
      checkmark.onPress();
      return;
    }

    const onPress = checkmark.onPress;
    const tappedGeneration = generation.current;

    if (isReduceMotionEnabled()) {
      onPress();
      return;
    }

    isAnimating.current = true;
    checkBounce.value = withSequence(
      withSpring(0.78, { damping: 10, stiffness: 380 }),
      withSpring(1.18, { damping: 7, stiffness: 300 }),
      withSpring(1.0, { damping: 16, stiffness: 260 })
    );
    fillProgress.value = withSpring(1, { damping: 14, stiffness: 200 });
    tickScale.value = withSpring(1, { damping: 9, stiffness: 320 });

    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      if (!isMounted.current || generation.current !== tappedGeneration) {
        // Recycled out from under us during the hold — commit anyway, skip
        // the exit (this cell is showing a different movie now).
        isAnimating.current = false;
        onPress();
        return;
      }
      cardScale.value = withTiming(0.9, { duration: EXIT_DURATION, easing: Easing.out(Easing.cubic) });
      // The commit rides the exit's completion so the fade is actually
      // seen (committing at exit-start would remove the item from `rows`
      // the same frame the fade begins). Not gated on `finished`: an
      // interrupted exit (another recycle mid-fade) must still commit, or
      // a recycle mid-fade would silently swallow the user's tap.
      cardOpacity.value = withTiming(
        0,
        { duration: EXIT_DURATION, easing: Easing.out(Easing.ease) },
        () => {
          runOnJS(onPress)();
          runOnJS(endExit)();
        }
      );
    }, EXIT_DELAY);
  }, [checkmark, fillProgress, tickScale, checkBounce, cardOpacity, cardScale, endExit]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  const checkCircleStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fillProgress.value, [0, 1], ['rgba(0,0,0,0.45)', c.accentFill]),
    borderColor: interpolateColor(fillProgress.value, [0, 1], ['rgba(255,255,255,0.7)', c.accentFill]),
    transform: [{ scale: checkBounce.value }],
  }));

  const tickStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tickScale.value }],
    opacity: tickScale.value,
  }));

  return (
    <Animated.View style={[styles.wrap, cardStyle]}>
      <PressableScale
        onPress={() => router.push(`/movie/${movieId}`)}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <View style={[styles.posterFrame, { backgroundColor: c.bgElevated }]}>
          <Image
            source={posterPath ? { uri: `${POSTER_BASE_URL}${posterPath}` } : undefined}
            style={styles.poster}
            contentFit="cover"
            transition={150}
            recyclingKey={String(movieId)}
            cachePolicy="memory-disk"
          />

          {ratingBadge && (
            <View style={styles.overlayBadge}>
              <Text style={styles.overlayBadgeText} numberOfLines={1}>
                {ratingBadge}
              </Text>
            </View>
          )}

          {checkmark && (
            // Plain Pressable, not PressableScale — checkBounce already
            // animates this same circle; see ShowPosterCard's identical note.
            <Pressable
              onPress={handleCheckPress}
              disabled={checkmark.disabled}
              hitSlop={8}
              style={[styles.checkBtn, checkmark.disabled && styles.checkBtnDisabled]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checkmark.isWatched, disabled: checkmark.disabled }}
              accessibilityLabel={
                checkmark.disabled
                  ? "Hasn't released yet"
                  : checkmark.isWatched
                  ? 'Mark as unwatched'
                  : 'Mark as watched'
              }
            >
              <Animated.View style={[styles.checkCircle, checkCircleStyle]}>
                <Animated.Text style={[styles.checkMark, { color: c.onAccent }, tickStyle]}>✓</Animated.Text>
              </Animated.View>
            </Pressable>
          )}
        </View>
      </PressableScale>

      <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: c.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export default memo(MoviePosterCardComponent);

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: 6,
  },
  posterFrame: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 16,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  overlayBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#FFFFFF',
  },
  checkBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  checkBtnDisabled: {
    opacity: 0.4,
  },
  checkCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 15,
    fontWeight: '900',
  },
  title: {
    marginTop: 8,
    marginHorizontal: 4,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
    lineHeight: 17,
  },
  subtitle: {
    marginTop: 2,
    marginHorizontal: 4,
    fontSize: 11,
    fontWeight: '600',
  },
});
