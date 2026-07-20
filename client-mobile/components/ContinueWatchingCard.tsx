// client-mobile/components/ContinueWatchingCard.tsx
import { Image } from 'expo-image';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';
import { ProgressRing } from './ProgressRing';

const BACKDROP_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const CARD_WIDTH = 240;

/**
 * Mirrors one item from GET /api/continue-watching/ (ContinueWatchingSerializer).
 * Kept as a standalone shape here rather than importing from watchStore.ts,
 * since Continue Watching isn't wired into the Zustand store yet — the
 * screen that eventually fetches it owns that shape.
 */
export interface ContinueWatchingItem {
  show: {
    tmdb_id: number;
    title: string;
    backdrop_path: string | null;
    poster_path: string | null;
  };
  next_episode: {
    tmdb_id: number;
    season_number: number;
    episode_number: number;
    title: string;
  } | null;
  watched_episode_count: number;
  aired_episode_count: number;
  progress_percentage: number;
}

export interface ContinueWatchingCardProps {
  item: ContinueWatchingItem;
  onPress: () => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function ContinueWatchingCardComponent({ item, onPress }: ContinueWatchingCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const imagePath = item.show.backdrop_path ?? item.show.poster_path;

  return (
    <PressableScale
      onPress={onPress}
      style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
    >
      <Image
        source={imagePath ? { uri: `${BACKDROP_BASE_URL}${imagePath}` } : undefined}
        style={[styles.image, { backgroundColor: c.bgElevated }]}
        contentFit="cover"
        transition={150}
      />
      {/* Scrim + caption text sit directly on the backdrop photo — kept a
          fixed dark wash/white text in both themes (photo-caption exception,
          see AI_RULES §2), so legibility doesn't depend on the photo's colors. */}
      <View style={styles.overlay} />
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {item.show.title}
        </Text>
        <Text style={styles.episodeLabel} numberOfLines={1}>
          {item.next_episode
            ? `Next: S${pad(item.next_episode.season_number)}E${pad(
                item.next_episode.episode_number
              )}`
            : 'All caught up'}
        </Text>
        <View style={styles.footerRow}>
          <ProgressRing
            percentage={item.progress_percentage}
            size={30}
            strokeWidth={3}
            showLabel={false}
            color={c.accentFill}
            trackColor="rgba(255,255,255,0.08)"
          />
          <Text style={styles.progressText}>
            {item.watched_episode_count}/{item.aired_episode_count} episodes
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

export const ContinueWatchingCard = memo(ContinueWatchingCardComponent);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: 130,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 12,
    gap: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  episodeLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  progressText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
});