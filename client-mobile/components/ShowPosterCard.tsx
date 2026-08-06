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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { isReduceMotionEnabled } from '../lib/motion';
import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

// Matches ShowRow's COLLAPSE_DELAY (components/ShowRow.tsx) — same job:
// hold the tapped episode's data still long enough for the tick to actually
// be seen. ShowRow can afford to commit late because its row physically
// leaves the list once it collapses; this card can't leave — buildRows()
// swaps it in place to the show's NEXT episode — so this deferral is the
// only thing standing between the tick appearing and the badge/subtitle/
// checkmark changing underneath it. See handleCheckPress below for why
// committing at t=0 instead (removing this entirely) is NOT the fix for
// grid mode's lag: the fix is not awaiting the network check before
// committing (see app/(tabs)/index.tsx's handleGridCheckPress) — that
// alone drops the lag from "up to a cold-start RTT" to this fixed 420ms.
const ADVANCE_DELAY = 420;
const CLEAR_TICK_MS = 130;
const CLEAR_FILL_MS = 200;

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
  // in place and its badge/subtitle swap to the next episode once the store
  // commits (buildRows advances this show to its next unwatched episode).
  const isAnimating = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  // Set true right before the deferred commit below fires, cleared by the
  // very next run of the reset effect. That run is OUR OWN commit's
  // consequence (checkmark.itemId changing to the next episode) — the
  // effect must not hard-snap over it, or the tick vanishes in the same
  // frame the badge changes underneath it (a jump-cut, exactly what the
  // deferral above exists to avoid). Every OTHER run of the effect (a
  // FlashList recycle, or the store changing this episode from elsewhere)
  // must still hard-snap — a cell recycled onto a different item must never
  // inherit whatever animation state its previous occupant left behind.
  // Props can't tell these two cases apart (checkmark.itemId changes in
  // both), so the card flags its own commit instead.
  const advancing = useRef(false);
  // Bumped every time the reset effect actually resets — a deferred commit
  // compares against the value it captured at tap time to tell whether this
  // cell still represents the item that was tapped (FlashList can recycle
  // this exact instance to a completely different show while the 420ms
  // timer is pending).
  const generation = useRef(0);

  const fillProgress = useSharedValue(checkmark?.isWatched ? 1 : 0);
  const tickScale = useSharedValue(checkmark?.isWatched ? 1 : 0);
  const checkBounce = useSharedValue(1);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  // Resets to the current prop state whenever this card starts representing
  // a different item (FlashList recycle) or the true watched state changes
  // out from under us — same guard ShowRow uses keyed on episodeId/isWatched.
  // See `advancing` above for why one specific run of this effect must skip
  // the reset instead.
  useEffect(() => {
    if (advancing.current) {
      advancing.current = false;
      return;
    }
    generation.current += 1;
    isAnimating.current = false;
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    fillProgress.value = checkmark?.isWatched ? 1 : 0;
    tickScale.value = checkmark?.isWatched ? 1 : 0;
    checkBounce.value = 1;
  }, [checkmark?.itemId, checkmark?.isWatched, fillProgress, tickScale, checkBounce]);

  // Both flags converge to false within CLEAR_FILL_MS of a commit — this
  // fires from the clearing animation below regardless of whether the reset
  // effect above ever runs again for this instance (e.g. an optimistic
  // toggle that gets rolled back to the same itemId/isWatched wouldn't
  // otherwise re-run it, which used to leave isAnimating stuck true and the
  // checkmark permanently dead on a failed request).
  const endAdvance = useCallback(() => {
    advancing.current = false;
    isAnimating.current = false;
  }, []);

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
    tickScale.value = withDelay(80, withSpring(1, { damping: 9, stiffness: 320 }));

    // Catch-up modal or not, the tapped episode always ends up watched (see
    // useCatchupCascade — every modal outcome finalizes it true), so it's
    // safe to always fire the real commit here; we're just giving the tick
    // time to be seen first — see ADVANCE_DELAY's comment for why this
    // deferral stays even though the actual network check no longer blocks
    // it (app/(tabs)/index.tsx's handleGridCheckPress fires it unawaited).
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      const stale = !isMounted.current || generation.current !== tappedGeneration;
      // Claimed BEFORE the commit so the reset effect's own dependency
      // change (triggered by onPress() below) can never race ahead of this
      // flag being set.
      if (!stale) advancing.current = true;

      onPress(); // Unconditional: the tap happened, it must reach the store.

      if (stale) {
        isAnimating.current = false;
        return;
      }

      // Clear the tick as the data swaps under it — "confirmed, then
      // cleared, ready for the next one." Not gated on the animation
      // actually finishing: an interrupted clear (another recycle mid-fade)
      // must still release the flags below, and there's nothing to lose by
      // clearing early since the commit already happened above.
      tickScale.value = withTiming(0, { duration: CLEAR_TICK_MS, easing: Easing.in(Easing.quad) });
      fillProgress.value = withTiming(
        0,
        { duration: CLEAR_FILL_MS, easing: Easing.out(Easing.quad) },
        () => {
          runOnJS(endAdvance)();
        }
      );
    }, ADVANCE_DELAY);
  }, [checkmark, fillProgress, tickScale, checkBounce, endAdvance]);

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
            // Plain Pressable, not PressableScale: the checkmark already has
            // its own checkBounce spring on the same 30px circle — stacking
            // PressableScale's press-in scale on top just fought it for the
            // same transform with no visible effect under checkBounce's
            // 0.78→1.18→1.0 sequence. ShowRow/MovieRow's list-mode checkmark
            // buttons are plain Pressables for the same reason.
            <Pressable
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
