// client-mobile/components/ShowRow.tsx
// Dense episode row for the Shows Hub (index.tsx).
// Layout: Poster | Show Title / Episode Label / Air Badge | Giant Checkmark
//
// V2.5 — Checkmark Fill & Auto-Advance animations:
//   1. On tap: border contract → neon fill erupts → tick scales in (spring)
//   2. Haptic feedback fires at the exact moment of tap
//   3. After 420ms the row collapses (height + opacity → 0) via spring
//   4. onAnimationComplete fires so the parent can trigger the Zustand update
//      which queues the next episode row into the list

import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useAppTheme } from '../lib/theme';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

// Row height used to animate collapse. Matches padding + poster height + margin.
const ROW_HEIGHT = 100; // poster 80 + 10+10 padding + 8 margin ≈ 108, clamp slightly lower for snap

export interface ShowRowProps {
  showId: number;
  showTitle: string;
  posterPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  episodeId: number;
  airDate: string | null;
  isWatched: boolean;
  /** Whether this episode has aired. A future episode can't be marked
   *  watched — the checkmark is disabled + dimmed when false. Defaults true
   *  so callers that don't pass it keep the old behaviour. */
  isAired?: boolean;
  /** Called by parent to initiate the watch-state toggle. The component
   *  will run its full animation sequence first, then fire this. */
  onCheckPress: (episodeId: number) => void;
  /** Optional: called after the exit animation fully completes.
   *  Use this to flush the Zustand update that replaces this row with
   *  the next episode, preventing a harsh jump before the animation ends. */
  onAnimationComplete?: (episodeId: number) => void;
}

// ─── Air date badge helper ────────────────────────────────────────────────────

function airDateBadge(
  airDate: string | null
): { label: string; style: 'normal' | 'imminent' | 'future' } | null {
  if (!airDate) return null;
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const airMs = new Date(`${airDate}T00:00:00`).getTime();
  const diffDays = Math.round((airMs - todayMs) / 86400000);

  if (diffDays === 0) return { label: 'TODAY', style: 'imminent' };
  if (diffDays === 1) return { label: 'TOMORROW', style: 'imminent' };
  if (diffDays > 1) return { label: `+${diffDays} DAYS`, style: 'future' };
  if (diffDays === -1) return { label: 'YESTERDAY', style: 'normal' };
  return { label: `${Math.abs(diffDays)} DAYS AGO`, style: 'normal' };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShowRow({
  showId,
  showTitle,
  posterPath,
  seasonNumber,
  episodeNumber,
  episodeTitle,
  episodeId,
  airDate,
  isWatched,
  isAired = true,
  onCheckPress,
  onAnimationComplete,
}: ShowRowProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  // Guard against double-tap during animation
  const isAnimating = useRef(false);

  // ── Shared values ────────────────────────────────────────────────────────
  // fillProgress: 0 = empty circle, 1 = fully filled neon yellow
  const fillProgress = useSharedValue(isWatched ? 1 : 0);
  // tickScale: the ✓ icon's scale
  const tickScale = useSharedValue(isWatched ? 1 : 0);
  // checkBounce: outer container spring-bounce
  const checkBounce = useSharedValue(1);

  // Row exit animation values
  const rowHeight = useSharedValue(ROW_HEIGHT);
  const rowOpacity = useSharedValue(1);
  const rowMargin = useSharedValue(8); // matches marginBottom in styles

  // Reset animation state when FlashList recycles this row for a new episode
  React.useEffect(() => {
    isAnimating.current = false;
    rowHeight.value = ROW_HEIGHT;
    rowOpacity.value = 1;
    rowMargin.value = 8;
    fillProgress.value = isWatched ? 1 : 0;
    tickScale.value = isWatched ? 1 : 0;
    checkBounce.value = 1;
  }, [episodeId, isWatched, rowHeight, rowOpacity, rowMargin, fillProgress, tickScale, checkBounce]);

  // ── Callbacks ────────────────────────────────────────────────────────────

  const notifyParent = useCallback(
    (epId: number) => {
      onCheckPress(epId);
    },
    [onCheckPress]
  );

  const notifyComplete = useCallback(
    (epId: number) => {
      onAnimationComplete?.(epId);
    },
    [onAnimationComplete]
  );

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleCheckPress = useCallback(() => {
    if (isAnimating.current) return;
    // Can't mark a future episode watched. (Un-watching is impossible here
    // anyway since an unaired episode can't already be watched.)
    if (!isAired && !isWatched) return;

    // ── 1. Haptic fires immediately ──────────────────────────────────────
    runOnJS(triggerHaptic)();

    // ── 2. Notify parent (optimistic store update starts) ────────────────
    runOnJS(notifyParent)(episodeId);

    if (!isWatched) {
      isAnimating.current = true;

      // ── 3. Checkmark bounce + fill sequence ──────────────────────────────
      // The outer ring contracts slightly then bounces back
      checkBounce.value = withSequence(
        withSpring(0.78, { damping: 10, stiffness: 380 }),
        withSpring(1.18, { damping: 7, stiffness: 300 }),
        withSpring(1.0, { damping: 16, stiffness: 260 })
      );

      // The fill floods in on a quick spring
      fillProgress.value = withSpring(1, { damping: 14, stiffness: 200 });

      // The tick icon pops in with a snap-overshoot
      tickScale.value = withDelay(
        80,
        withSpring(1, { damping: 9, stiffness: 320 })
      );

      // ── 4. Row collapse after 420ms ──────────────────────────────────────
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
          if (finished) {
            runOnJS(notifyComplete)(episodeId);
          }
        })
      );
    } else {
      // Un-watching: just reverse fill smoothly
      fillProgress.value = withSpring(0, { damping: 16, stiffness: 200 });
      tickScale.value = withTiming(0, { duration: 160 });
      checkBounce.value = withSequence(
        withSpring(0.88, { damping: 12, stiffness: 300 }),
        withSpring(1.0, { damping: 14, stiffness: 240 })
      );
    }
  }, [
    episodeId,
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

  // ── Animated styles ──────────────────────────────────────────────────────

  // Row wrapper: height + opacity collapse on exit
  const rowWrapperStyle = useAnimatedStyle(() => ({
    height: isWatched ? 'auto' : rowHeight.value,
    opacity: rowOpacity.value,
    marginBottom: rowMargin.value,
    overflow: 'hidden',
  }));

  // Outer bounce wrapper for the checkmark button
  const checkBounceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkBounce.value }],
  }));

  // The circle: border color + background fill interpolated 0→1
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
    return {
      backgroundColor: bg,
      borderColor,
    };
  });

  // The ✓ tick: scale + slight rotation for a satisfying pop
  const tickStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: tickScale.value },
      {
        rotate: `${interpolate(tickScale.value, [0, 0.5, 1], [-20, 8, 0])}deg`,
      },
    ],
    opacity: tickScale.value,
  }));

  const badge = airDateBadge(airDate);

  return (
    <Animated.View style={rowWrapperStyle}>
      <Pressable
        style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
        onPress={() => router.push(`/show/${showId}`)}
        accessibilityRole="button"
        accessibilityLabel={`${showTitle} — Season ${seasonNumber} Episode ${episodeNumber}`}
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
          <Text style={[styles.showTitle, { color: c.textPrimary }]} numberOfLines={1}>
            {showTitle}
          </Text>
          <Text style={[styles.episodeLabel, { color: c.accentInk }]} numberOfLines={1}>
            S{pad(seasonNumber)} · E{pad(episodeNumber)}
          </Text>
          <Text style={[styles.episodeTitle, { color: c.textSecondary }]} numberOfLines={1}>
            {episodeTitle}
          </Text>
          {badge && (
            <View
              style={[
                styles.badge,
                { backgroundColor: c.glassFill, borderColor: c.hairline },
                badge.style === 'imminent' && { backgroundColor: c.accentDim, borderColor: c.accentInk },
                badge.style === 'future' && styles.badgeFuture,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: c.textSecondary },
                  badge.style === 'imminent' && { color: c.accentInk },
                ]}
              >
                {badge.label}
              </Text>
            </View>
          )}
        </View>

        {/* ── Giant Animated Checkmark ── */}
        <Animated.View style={[checkBounceStyle, !isAired && !isWatched && styles.checkDisabled]}>
          <Pressable
            onPress={handleCheckPress}
            disabled={!isAired && !isWatched}
            hitSlop={12}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isWatched, disabled: !isAired && !isWatched }}
            accessibilityLabel={
              !isAired && !isWatched
                ? "Hasn't aired yet"
                : isWatched
                ? 'Mark as unwatched'
                : 'Mark as watched'
            }
          >
            {/* The animated circle */}
            <Animated.View style={[styles.checkCircle, circleStyle]}>
              {/* The animated tick */}
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
    gap: 3,
  },
  showTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  episodeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  episodeTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeFuture: {
    backgroundColor: 'rgba(120,120,200,0.15)',
    borderColor: 'rgba(120,120,200,0.3)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  checkDisabled: {
    opacity: 0.3,
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
