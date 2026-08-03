// client-mobile/components/ActivityRow.tsx
// One card in the friends activity feed — a review left by someone you
// follow (Phase 75.6; was raw watch activity — see
// core/social_views.py::FriendsActivityView's docstring for why that
// changed). Reuses StarRatingDisplay.tsx, the same read-only star row
// app/profile/reviews.tsx's own review rows use.

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Clapperboard, Tv } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import type { ActivityCard } from '../store/socialStore';
import GlassSurface from './GlassSurface';
import PressableScale from './PressableScale';
import StarRatingDisplay from './StarRatingDisplay';

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

  const detailHref = card.media_type === 'tv' ? `/show/${card.tmdb_id}` : `/movie/${card.tmdb_id}`;

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

      <PressableScale style={styles.textColumn} onPress={() => router.push(detailHref as any)}>
        <Text style={[styles.line, { color: c.textPrimary }]} numberOfLines={1}>
          <Text style={styles.username} onPress={() => router.push(`/user/${card.username}` as any)}>
            {card.username}
          </Text>{' '}
          rated <Text style={styles.mediaTitle}>{card.title}</Text>
        </Text>
        <StarRatingDisplay rating={card.rating} size={13} gap={1} />
        {card.note ? (
          <Text style={[styles.note, { color: c.textSecondary }]} numberOfLines={2}>
            {card.note}
          </Text>
        ) : null}
        <Text style={[styles.timestamp, { color: c.textTertiary }]}>{timeAgo(card.updated_at)}</Text>
      </PressableScale>

      <PressableScale onPress={() => router.push(detailHref as any)}>
        {card.poster_path ? (
          <Image
            source={{ uri: `${POSTER_BASE_URL}${card.poster_path}` }}
            style={[styles.poster, { backgroundColor: c.bgElevated }]}
          />
        ) : (
          <View style={[styles.posterFallback, { backgroundColor: c.bgElevated }]}>
            {card.media_type === 'tv' ? (
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
    gap: 3,
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
  note: {
    fontSize: 12,
    lineHeight: 16,
  },
  timestamp: {
    fontSize: 11,
    marginTop: 1,
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
