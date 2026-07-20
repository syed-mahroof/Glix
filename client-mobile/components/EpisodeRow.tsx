// client-mobile/components/EpisodeRow.tsx
import { Image } from 'expo-image';
import { Check, Eye } from 'lucide-react-native';
import React, { memo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { pad, todayLocalIso } from '../lib/dateFormat';
import { useAppTheme } from '../lib/theme';
import { Episode } from '../store/watchStore';
import PressableScale from './PressableScale';

const STILL_BASE_URL = 'https://image.tmdb.org/t/p/w300';

export interface EpisodeRowProps {
  episode: Episode;
  onToggleWatched: (episodeId: number) => void;
  onPress: (episodeId: number) => void;
  isToggling?: boolean;
}

function EpisodeRowComponent({
  episode,
  onToggleWatched,
  onPress,
  isToggling = false,
}: EpisodeRowProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  // Spoiler protection: overview stays hidden behind a blur/placeholder
  // until the episode is watched, or the user explicitly reveals it.
  const [isRevealed, setIsRevealed] = useState(episode.is_watched);
  const showOverview = episode.is_watched || isRevealed;

  // A future episode can't be marked watched — disable its toggle. Un-watching
  // stays possible (an already-watched episode with a bad/late air_date).
  const todayIso = todayLocalIso();
  const isAired = !!episode.air_date && episode.air_date <= todayIso;
  const toggleDisabled = isToggling || (!isAired && !episode.is_watched);

  return (
    <PressableScale
      style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
      onPress={() => onPress(episode.tmdb_id)}
    >
      <Image
        source={episode.still_path ? { uri: `${STILL_BASE_URL}${episode.still_path}` } : undefined}
        style={[styles.still, { backgroundColor: c.bgElevated }]}
        contentFit="cover"
        transition={150}
      />

      <View style={styles.textColumn}>
        <Text style={[styles.episodeLabel, { color: c.accentInk }]}>
          E{pad(episode.episode_number)} · {episode.runtime_minutes || '—'} min
        </Text>
        <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
          {episode.title || `Episode ${episode.episode_number}`}
        </Text>

        {showOverview ? (
          <Text style={[styles.overview, { color: c.textSecondary }]} numberOfLines={2}>
            {episode.overview || 'No description available.'}
          </Text>
        ) : (
          <PressableScale
            onPress={(event) => {
              event.stopPropagation();
              setIsRevealed(true);
            }}
            style={styles.spoilerRow}
            hitSlop={4}
          >
            <Eye color={c.textTertiary} size={12} />
            <Text style={[styles.spoilerText, { color: c.textTertiary }]}>Tap to reveal synopsis</Text>
          </PressableScale>
        )}

        {episode.air_date ? (
          <Text style={[styles.airDate, { color: c.textTertiary }]}>{episode.air_date}</Text>
        ) : null}
      </View>

      <PressableScale
        onPress={(event) => {
          event.stopPropagation();
          onToggleWatched(episode.tmdb_id);
        }}
        disabled={toggleDisabled}
        hitSlop={8}
        style={[
          styles.watchToggle,
          { borderColor: c.hairline },
          episode.is_watched && { backgroundColor: c.accentFill, borderColor: c.accentFill },
          !isAired && !episode.is_watched && styles.watchToggleDisabled,
        ]}
        accessibilityLabel={
          !isAired && !episode.is_watched ? "Hasn't aired yet" : undefined
        }
      >
        {isToggling ? (
          <ActivityIndicator size="small" color={episode.is_watched ? c.onAccent : c.accentInk} />
        ) : episode.is_watched ? (
          <Check color={c.onAccent} size={16} strokeWidth={3} />
        ) : null}
      </PressableScale>
    </PressableScale>
  );
}

export const EpisodeRow = memo(EpisodeRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 8,
  },
  still: {
    width: 92,
    height: 60,
    borderRadius: 8,
  },
  textColumn: {
    flex: 1,
    gap: 3,
  },
  episodeLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
  },
  overview: {
    fontSize: 11,
    lineHeight: 15,
  },
  spoilerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  spoilerText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  airDate: {
    fontSize: 10,
    marginTop: 1,
  },
  watchToggle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchToggleDisabled: {
    opacity: 0.3,
  },
});