import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { isReduceMotionEnabled } from '../lib/motion';
import { useAppTheme } from '../lib/theme';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

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
  onCheckPress: (episodeId: number) => void;
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

// Not memoized before (Phase 74 perf pass) — the Shows Hub list re-rendered
// every visible row on any watchlist mutation anywhere, not just the row
// whose own props actually changed, which is exactly what a tap on one
// row's checkmark feeling like it's dragging the whole list with it looks
// like. Same memo(...) pattern EpisodeRow/CommentCard already use.
function ShowRowComponent({
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
}: ShowRowProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const fillProgress = useSharedValue(isWatched ? 1 : 0);
  const tickScale = useSharedValue(isWatched ? 1 : 0);
  const checkBounce = useSharedValue(1);

  React.useEffect(() => {
    fillProgress.value = isWatched ? 1 : 0;
    tickScale.value = isWatched ? 1 : 0;
    checkBounce.value = 1;
  }, [episodeId, isWatched, fillProgress, tickScale, checkBounce]);

  const handleCheckPress = useCallback(() => {
    if (!isAired && !isWatched) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!isReduceMotionEnabled()) {
      checkBounce.value = withSequence(
        withTiming(0.94, { duration: 80 }),
        withSpring(1, { damping: 20, stiffness: 350 })
      );
    }
    // Commit at tap time. Keep the show's cell and height while its episode
    // advances; delayed collapse made the next action move off-screen.
    onCheckPress(episodeId);
  }, [episodeId, isAired, isWatched, onCheckPress, checkBounce]);

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
    <View style={{ marginBottom: 8 }}>
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
          recyclingKey={String(showId)}
          cachePolicy="memory-disk"
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
            onPress={(event) => { event.stopPropagation(); handleCheckPress(); }}
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
    </View>
  );
}

export default memo(ShowRowComponent);

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
