// client-mobile/components/SeasonCard.tsx
import { Image } from 'expo-image';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
}

function SeasonCardComponent({
  seasonNumber,
  showPosterPath,
  episodeCount,
  watchedCount,
  onPress,
}: SeasonCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const hasCounts = typeof episodeCount === 'number' && episodeCount > 0;
  const progress = hasCounts ? Math.round(((watchedCount ?? 0) / episodeCount!) * 1000) / 10 : 0;

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
          exception). */}
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
});