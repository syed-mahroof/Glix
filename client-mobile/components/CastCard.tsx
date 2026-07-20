// client-mobile/components/CastCard.tsx
import { Image } from 'expo-image';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

const PROFILE_BASE_URL = 'https://image.tmdb.org/t/p/w185';
const CARD_WIDTH = 92;

export interface CastCardProps {
  name: string;
  /** Character name (cast) or job title (crew) — whichever the caller has. */
  role: string;
  profilePath: string | null;
  /** Optional secondary line, e.g. episode count ("42 episodes"). */
  footnote?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function CastCardComponent({ name, role, profilePath, footnote }: CastCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      {profilePath ? (
        <Image
          source={{ uri: `${PROFILE_BASE_URL}${profilePath}` }}
          style={[styles.photo, { backgroundColor: c.bgElevated }]}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.photoFallback, { backgroundColor: c.accentDim }]}>
          <Text style={[styles.photoFallbackText, { color: c.accentInk }]}>{initials(name)}</Text>
        </View>
      )}
      <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={2}>
        {name}
      </Text>
      <Text style={[styles.role, { color: c.textSecondary }]} numberOfLines={2}>
        {role || '—'}
      </Text>
      {footnote ? (
        <Text style={[styles.footnote, { color: c.textTertiary }]} numberOfLines={1}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

export const CastCard = memo(CastCardComponent);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 8,
    alignItems: 'center',
    gap: 4,
  },
  photo: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  photoFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackText: {
    fontSize: 16,
    fontWeight: '800',
  },
  name: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  role: {
    fontSize: 10,
    textAlign: 'center',
  },
  footnote: {
    fontSize: 9,
    textAlign: 'center',
  },
});