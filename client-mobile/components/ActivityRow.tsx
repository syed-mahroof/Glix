// client-mobile/components/ActivityRow.tsx
// One card in the friends activity feed (Phase 74) — either a collapsed
// multi-episode binge or a single movie watch. See
// core/social_views.py::FriendsActivityView for how these are built.

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Clapperboard, Tv } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import type { ActivityCard } from '../store/socialStore';
import GlassSurface from './GlassSurface';
import PressableScale from './PressableScale';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface ActivityRowProps {
  card: ActivityCard;
}

export default function ActivityRow({ card }: ActivityRowProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const isEpisodes = card.type === 'episodes';
  const posterPath = isEpisodes ? card.poster_path : card.poster_path;
  const title = isEpisodes ? card.show_title : card.movie_title;
  const detailHref = isEpisodes ? `/show/${card.show_id}` : `/movie/${card.movie_id}`;

  return (
    <GlassSurface radius={14} style={styles.card}>
      <PressableScale onPress={() => router.push(`/user/${card.username}` as any)}>
        {card.profile_picture ? (
          <Image source={{ uri: card.profile_picture }} style={[styles.avatar, { backgroundColor: c.bgElevated }]} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: c.accentDim }]}>
            <Text style={[styles.avatarFallbackText, { color: c.accentInk }]}>
              {card.username.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
      </PressableScale>

      <View style={styles.textColumn}>
        <Text style={[styles.line, { color: c.textPrimary }]} numberOfLines={2}>
          <Text style={styles.username} onPress={() => router.push(`/user/${card.username}` as any)}>
            {card.username}
          </Text>{' '}
          watched{' '}
          {isEpisodes ? (
            <Text style={styles.mediaTitle}>
              {card.episode_count} episode{card.episode_count === 1 ? '' : 's'} of {title}
            </Text>
          ) : (
            <Text style={styles.mediaTitle}>{title}</Text>
          )}
        </Text>
        <Text style={[styles.timestamp, { color: c.textTertiary }]}>{timeAgo(card.watched_at)}</Text>
      </View>

      <PressableScale onPress={() => router.push(detailHref as any)}>
        {posterPath ? (
          <Image source={{ uri: `${POSTER_BASE_URL}${posterPath}` }} style={[styles.poster, { backgroundColor: c.bgElevated }]} />
        ) : (
          <View style={[styles.posterFallback, { backgroundColor: c.bgElevated }]}>
            {isEpisodes ? (
              <Tv color={c.textTertiary} size={16} strokeWidth={1.75} />
            ) : (
              <Clapperboard color={c.textTertiary} size={16} strokeWidth={1.75} />
            )}
          </View>
        )}
      </PressableScale>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 12,
    fontWeight: '800',
  },
  textColumn: {
    flex: 1,
  },
  line: {
    fontSize: 13,
    lineHeight: 18,
  },
  username: {
    fontWeight: '800',
  },
  mediaTitle: {
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 11,
    marginTop: 3,
  },
  poster: {
    width: 36,
    height: 52,
    borderRadius: 6,
  },
  posterFallback: {
    width: 36,
    height: 52,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
