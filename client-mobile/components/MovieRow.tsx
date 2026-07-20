// client-mobile/components/MovieRow.tsx
// Dense movie row for the Movies Hub (movies.tsx).
// Layout: Poster | Movie Title / Runtime • Genres | Giant Animated Checkmark
//
// Checkmark micro-interaction is identical to ShowRow V2.5:
//   1. On tap: haptic → border contract/overshoot spring → neon fill floods in → tick pops in
//   2. 420ms delay → row collapses (height/opacity/margin → 0)
//   3. onAnimationComplete fires so parent can flush Zustand update

import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useAppTheme } from '../lib/theme';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

const ROW_HEIGHT = 108; // poster 80 + padding 20 + margin 8

export interface MovieRowProps {
  movieId: number;
  title: string;
  posterPath: string | null;
  runtimeMinutes: number;
  genresString: string;
  isWatched: boolean;
  onCheckPress: (movieId: number) => void;
  onAnimationComplete?: (movieId: number) => void;
}

function formatRuntime(minutes: number): string {
  if (minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function MovieRow({
  movieId,
  title,
  posterPath,
  runtimeMinutes,
  genresString,
  isWatched,
  onCheckPress,
  onAnimationComplete,
}: MovieRowProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const isAnimating = useRef(false);

  // ── Shared animation values ───────────────────────────────────────────
  const fillProgress = useSharedValue(isWatched ? 1 : 0);
  const tickScale = useSharedValue(isWatched ? 1 : 0);
  const checkBounce = useSharedValue(1);
  const rowHeight = useSharedValue(ROW_HEIGHT);
  const rowOpacity = useSharedValue(1);
  const rowMargin = useSharedValue(8);

  // Reset animation state when FlashList recycles this row for a different
  // movie / watched state. Without this, switching WATCH NEXT → WATCHED
  // reuses a row component whose fillProgress is still 0, so an already-
  // watched movie renders as an EMPTY circle (the reported bug). Mirrors
  // ShowRow's recycling-reset effect.
  React.useEffect(() => {
    isAnimating.current = false;
    rowHeight.value = ROW_HEIGHT;
    rowOpacity.value = 1;
    rowMargin.value = 8;
    fillProgress.value = isWatched ? 1 : 0;
    tickScale.value = isWatched ? 1 : 0;
    checkBounce.value = 1;
  }, [movieId, isWatched, rowHeight, rowOpacity, rowMargin, fillProgress, tickScale, checkBounce]);

  // ── Callbacks ─────────────────────────────────────────────────────────
  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const notifyParent = useCallback(
    (id: number) => onCheckPress(id),
    [onCheckPress]
  );

  const notifyComplete = useCallback(
    (id: number) => onAnimationComplete?.(id),
    [onAnimationComplete]
  );

  const handleCheckPress = useCallback(() => {
    if (isAnimating.current) return;

    runOnJS(triggerHaptic)();
    runOnJS(notifyParent)(movieId);

    if (!isWatched) {
      isAnimating.current = true;

      // Outer ring spring bounce
      checkBounce.value = withSequence(
        withSpring(0.78, { damping: 10, stiffness: 380 }),
        withSpring(1.18, { damping: 7, stiffness: 300 }),
        withSpring(1.0, { damping: 16, stiffness: 260 })
      );

      // Fill floods in
      fillProgress.value = withSpring(1, { damping: 14, stiffness: 200 });

      // Tick pops in with snap-overshoot
      tickScale.value = withDelay(
        80,
        withSpring(1, { damping: 9, stiffness: 320 })
      );

      // Row collapse after 420ms
      const COLLAPSE_DELAY = 420;
      const COLLAPSE_DURATION = 340;

      rowOpacity.value = withDelay(
        COLLAPSE_DELAY,
        withTiming(0, { duration: COLLAPSE_DURATION, easing: Easing.out(Easing.ease) })
      );
      rowHeight.value = withDelay(
        COLLAPSE_DELAY,
        withTiming(0, { duration: COLLAPSE_DURATION, easing: Easing.out(Easing.cubic) })
      );
      rowMargin.value = withDelay(
        COLLAPSE_DELAY,
        withTiming(0, { duration: COLLAPSE_DURATION, easing: Easing.out(Easing.ease) }, (finished) => {
          if (finished) runOnJS(notifyComplete)(movieId);
        })
      );
    } else {
      // Un-watching: reverse fill
      fillProgress.value = withSpring(0, { damping: 16, stiffness: 200 });
      tickScale.value = withTiming(0, { duration: 160 });
      checkBounce.value = withSequence(
        withSpring(0.88, { damping: 12, stiffness: 300 }),
        withSpring(1.0, { damping: 14, stiffness: 240 })
      );
    }
  }, [
    movieId,
    isWatched,
    fillProgress,
    tickScale,
    checkBounce,
    rowHeight,
    rowOpacity,
    rowMargin,
    notifyParent,
    notifyComplete,
    triggerHaptic,
  ]);

  // ── Animated styles ───────────────────────────────────────────────────

  const rowWrapperStyle = useAnimatedStyle(() => ({
    height: isWatched ? 'auto' : rowHeight.value,
    opacity: rowOpacity.value,
    marginBottom: rowMargin.value,
    overflow: 'hidden',
  }));

  const checkBounceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkBounce.value }],
  }));

  const circleStyle = useAnimatedStyle(() => {
    const bg = interpolateColor(
      fillProgress.value,
      [0, 1],
      ['rgba(0,0,0,0)', c.accentFill]
    );
    const borderColor = interpolateColor(
      fillProgress.value,
      [0, 0.3, 1],
      [c.hairline, c.accentDim, c.accentFill]
    );
    return { backgroundColor: bg, borderColor };
  });

  const tickStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: tickScale.value },
      { rotate: `${interpolate(tickScale.value, [0, 0.5, 1], [-20, 8, 0])}deg` },
    ],
    opacity: tickScale.value,
  }));

  const runtime = formatRuntime(runtimeMinutes);
  const meta = [runtime, genresString].filter(Boolean).join(' · ');

  return (
    <Animated.View style={rowWrapperStyle}>
      <Pressable
        style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
        onPress={() => router.push(`/movie/${movieId}`)}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {/* Poster */}
        <Image
          source={posterPath ? { uri: `${POSTER_BASE_URL}${posterPath}` } : undefined}
          style={[styles.poster, { backgroundColor: c.bgElevated }]}
          contentFit="cover"
          transition={150}
        />

        {/* Text column */}
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={2}>
            {title}
          </Text>
          {meta ? (
            <Text style={[styles.meta, { color: c.textSecondary }]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>

        {/* Animated Checkmark */}
        <Animated.View style={checkBounceStyle}>
          <Pressable
            onPress={handleCheckPress}
            hitSlop={12}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isWatched }}
            accessibilityLabel={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
          >
            <Animated.View style={[styles.checkCircle, circleStyle]}>
              <Animated.Text style={[styles.checkMark, { color: c.onAccent }, tickStyle]}>✓</Animated.Text>
            </Animated.View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
  },
  poster: {
    width: 54,
    height: 80,
    borderRadius: 10,
  },
  textCol: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  checkCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 24,
  },
});
