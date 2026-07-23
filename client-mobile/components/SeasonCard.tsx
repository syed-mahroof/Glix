// client-mobile/components/SeasonCard.tsx
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';
import { ProgressRing } from './ProgressRing';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

export interface SeasonCardProps {
  seasonNumber: number;
  /** Fallback background when TMDB doesn't have a season-specific poster (Glix doesn't cache one). */
  showPosterPath: string | null;
  /** Undefined while episode counts haven't been fetched for this season yet. */
  episodeCount?: number;
  watchedCount?: number;
  onPress: () => void;
  /** Marks/unmarks this entire season watched without navigating into the
   *  season screen (Phase D). Omitted — no affordance rendered — when the
   *  show isn't in the user's watchlist yet, since there's nothing to toggle. */
  onToggleWatched?: () => void;
  isTogglingWatched?: boolean;
}

function SeasonCardComponent({
  seasonNumber,
  showPosterPath,
  episodeCount,
  watchedCount,
  onPress,
  onToggleWatched,
  isTogglingWatched = false,
}: SeasonCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const hasCounts = typeof episodeCount === 'number' && episodeCount > 0;
  const progress = hasCounts ? Math.round(((watchedCount ?? 0) / episodeCount!) * 1000) / 10 : 0;
  const isFullyWatched = hasCounts && watchedCount === episodeCount;
  // Only known-disableable when the count is already cached locally (a
  // season with zero aired episodes yet). For an uncached season the tap
  // handler fetches it fresh and no-ops itself if there's nothing to mark —
  // same "nothing to do" outcome, just decided after one round trip instead
  // of before, since there's no count to check ahead of time.
  const knownNothingToMark = typeof episodeCount === 'number' && episodeCount === 0;

  return (
    <PressableScale
      onPress={onPress}
      style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
    >
      <Image
        source={showPosterPath ? { uri: `${POSTER_BASE_URL}${showPosterPath}` } : undefined}
        style={[styles.poster, { backgroundColor: c.bgElevated }]}
        contentFit="cover"
        transition={150}
      />
      {/* Scrim + caption text sit directly on the poster photo — kept a fixed
          dark wash/white text in both themes so captions stay legible
          regardless of the photo's own colors (see AI_RULES §2 photo-caption
          exception). The watch-toggle below follows the same rule for its
          unwatched/outline state, but still pulls accentFill/onAccent for
          its watched state — identical in both themes already, same
          precedent as show/[id].tsx's own floating icon buttons. */}
      <View style={styles.overlay} />
      <View style={styles.content}>
        <View style={styles.textColumn}>
          <Text style={styles.title}>Season {seasonNumber}</Text>
          <Text style={styles.subtitle}>
            {hasCounts
              ? `${watchedCount ?? 0} of ${episodeCount} watched`
              : 'Tap to view episodes'}
          </Text>
        </View>
        {hasCounts && (
          <ProgressRing
            percentage={progress}
            size={36}
            strokeWidth={3}
            color={c.accentFill}
            trackColor="rgba(255,255,255,0.08)"
          />
        )}
        {onToggleWatched && (
          <PressableScale
            onPress={(event) => {
              event.stopPropagation();
              onToggleWatched();
            }}
            disabled={isTogglingWatched || knownNothingToMark}
            hitSlop={8}
            style={[
              styles.watchToggle,
              isFullyWatched && { backgroundColor: c.accentFill, borderColor: c.accentFill },
              knownNothingToMark && styles.watchToggleDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={isFullyWatched ? 'Unmark Season Watched' : 'Mark Season Watched'}
          >
            {isTogglingWatched ? (
              <ActivityIndicator size="small" color={isFullyWatched ? c.onAccent : '#FFFFFF'} />
            ) : isFullyWatched ? (
              <Check color={c.onAccent} size={16} strokeWidth={3} />
            ) : null}
          </PressableScale>
        )}
      </View>
    </PressableScale>
  );
}

export const SeasonCard = memo(SeasonCardComponent);

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    height: 84,
  },
  poster: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
  watchToggle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchToggleDisabled: {
    opacity: 0.3,
  },
});