// client-mobile/components/ShowPosterCard.tsx
// Large poster-centric grid card for Shows Hub / Profile > My Shows Grid
// View. Distinct from the dense `ShowRow.tsx` — this is the "completely
// different card type" the 2-column grid layout calls for, not a squeezed
// row. Badges (episode label, countdown, status) are painted directly on
// top of the poster photo, so per AI_RULES.md's documented photo-caption
// exception they stay a fixed dark-wash + white treatment in both themes —
// legibility over an arbitrary TMDB image can't depend on the app's
// light/dark preference. The "imminent" highlight and the watched
// checkmark use `accentFill`/`onAccent` instead, since that pair is by
// design legible over any ground (always bright fill + dark text).

import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

export interface ShowPosterCardProps {
  showId: number;
  title: string;
  posterPath: string | null;
  /** e.g. "S01 · E04" or a status label — rendered as a photo-caption
   *  overlay badge in the poster's top-left corner. */
  overlayBadge?: string;
  /** Highlights the overlay badge with the bright accent fill instead of
   *  the default dark scrim — used for "airing today/tomorrow" urgency. */
  overlayBadgeHighlighted?: boolean;
  /** Secondary line under the title (episode title, genres, etc.). */
  subtitle?: string;
  /** 0–100. Renders a slim progress bar under the title when provided. */
  progressPercentage?: number;
  /** Renders a bottom-right watched-state checkmark overlaid on the poster
   *  when provided. Omit for read-only contexts (e.g. Upcoming). */
  checkmark?: {
    isWatched: boolean;
    disabled?: boolean;
    onPress: () => void;
    /** Stable identity for the checked item (e.g. the episode's tmdb_id).
     *  Drives the reset-on-recycle effect below so a FlashList cell reused
     *  for a different episode snaps to that episode's real state instead
     *  of inheriting an in-flight tap animation from whatever used to be
     *  in this slot. */
    itemId?: number | string;
  };
}

// Not memoized before (Phase 74 perf pass) — same reasoning as ShowRow:
// the grid-view list re-rendered every visible card on any watchlist
// mutation anywhere, not just the card that actually changed.
function ShowPosterCardComponent({
  showId,
  title,
  posterPath,
  overlayBadge,
  overlayBadgeHighlighted,
  subtitle,
  progressPercentage,
  checkmark,
}: ShowPosterCardProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  // Grid-mode checkmark animation (mirrors ShowRow's fill/tick/bounce
  // sequence). Unlike ShowRow, there's no row to collapse — the card stays
  // in place and its badge/subtitle swap straight to the next episode once
  // the store commits. Committing on tap (the old behaviour) meant that
  // swap happened in the same render as the tap: the tick never got a
  // chance to actually appear before the card jumped to the next episode's
  // empty checkmark. Deferring the commit lets the fill+tick play out
  // first, so the swap reads as "confirmed, then advanced" instead of a
  // jump-cut.
  const isAnimating = useRef(false);
  const fillProgress = useSharedValue(checkmark?.isWatched ? 1 : 0);
  const tickScale = useSharedValue(checkmark?.isWatched ? 1 : 0);
  const checkBounce = useSharedValue(1);

  // Resets to the current prop state whenever this card starts representing
  // a different item (FlashList recycle) or the true watched state changes
  // out from under us — same guard ShowRow uses keyed on episodeId/isWatched.
  useEffect(() => {
    isAnimating.current = false;
    fillProgress.value = checkmark?.isWatched ? 1 : 0;
    tickScale.value = checkmark?.isWatched ? 1 : 0;
    checkBounce.value = 1;
  }, [checkmark?.itemId, checkmark?.isWatched, fillProgress, tickScale, checkBounce]);

  const handleCheckPress = useCallback(() => {
    if (!checkmark) return;
    if (isAnimating.current) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (checkmark.isWatched) {
      // Un-watching: same item stays put, just reverse the fill — no
      // commit delay needed since nothing is about to swap underneath it.
      fillProgress.value = withSpring(0, { damping: 16, stiffness: 200 });
      tickScale.value = withTiming(0, { duration: 160 });
      checkBounce.value = withSequence(
        withSpring(0.88, { damping: 12, stiffness: 300 }),
        withSpring(1.0, { damping: 14, stiffness: 240 })
      );
      checkmark.onPress();
      return;
    }

    isAnimating.current = true;
    checkBounce.value = withSequence(
      withSpring(0.78, { damping: 10, stiffness: 380 }),
      withSpring(1.18, { damping: 7, stiffness: 300 }),
      withSpring(1.0, { damping: 16, stiffness: 260 })
    );
    fillProgress.value = withSpring(1, { damping: 14, stiffness: 200 });
    tickScale.value = withDelay(80, withSpring(1, { damping: 9, stiffness: 320 }));

    // Catch-up modal or not, the tapped episode always ends up watched (see
    // useCatchupCascade — every modal outcome finalizes it true), so it's
    // safe to always fire the real commit here; we're just giving the tick
    // time to be seen first.
    setTimeout(() => {
      checkmark.onPress();
    }, 450);
  }, [checkmark, fillProgress, tickScale, checkBounce]);

  const checkCircleStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fillProgress.value,
      [0, 1],
      ['rgba(0,0,0,0.45)', c.accentFill]
    ),
    borderColor: interpolateColor(
      fillProgress.value,
      [0, 1],
      ['rgba(255,255,255,0.7)', c.accentFill]
    ),
    transform: [{ scale: checkBounce.value }],
  }));

  const tickStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tickScale.value }],
    opacity: tickScale.value,
  }));

  return (
    <View style={styles.wrap}>
      <PressableScale
        onPress={() => router.push(`/show/${showId}`)}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <View style={[styles.posterFrame, { backgroundColor: c.bgElevated }]}>
          <Image
            source={posterPath ? { uri: `${POSTER_BASE_URL}${posterPath}` } : undefined}
            style={styles.poster}
            contentFit="cover"
            transition={150}
            recyclingKey={String(showId)}
            cachePolicy="memory-disk"
          />

          {overlayBadge && (
            <View
              style={[
                styles.overlayBadge,
                overlayBadgeHighlighted
                  ? { backgroundColor: c.accentFill }
                  : styles.overlayBadgeDefault,
              ]}
            >
              <Text
                style={[
                  styles.overlayBadgeText,
                  { color: overlayBadgeHighlighted ? c.onAccent : '#FFFFFF' },
                ]}
                numberOfLines={1}
              >
                {overlayBadge}
              </Text>
            </View>
          )}

          {checkmark && (
            <PressableScale
              onPress={handleCheckPress}
              disabled={checkmark.disabled}
              hitSlop={8}
              style={[styles.checkBtn, checkmark.disabled && styles.checkBtnDisabled]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checkmark.isWatched, disabled: checkmark.disabled }}
              accessibilityLabel={checkmark.isWatched ? 'Mark as unwatched' : 'Mark as watched'}
            >
              <Animated.View style={[styles.checkCircle, checkCircleStyle]}>
                <Animated.Text style={[styles.checkMark, { color: c.onAccent }, tickStyle]}>✓</Animated.Text>
              </Animated.View>
            </PressableScale>
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
      {progressPercentage !== undefined && (
        <View style={[styles.progressTrack, { backgroundColor: c.trackRing }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: c.accentFill, width: `${Math.min(progressPercentage, 100)}%` as any },
            ]}
          />
        </View>
      )}
    </View>
  );
}

export default memo(ShowPosterCardComponent);

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
    maxWidth: '80%',
  },
  overlayBadgeDefault: {
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
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
  progressTrack: {
    marginTop: 6,
    marginHorizontal: 4,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
});
