// client-mobile/components/MoviePosterCard.tsx
// Large poster-centric grid card for Movies Hub / Profile > My Movies Grid
// View — the movie counterpart to `ShowPosterCard.tsx`. Same photo-caption
// overlay rules: badges painted on the poster stay a fixed dark-wash/white
// treatment (or accentFill/onAccent for the watched checkmark, which is
// legible over any ground by design), while text below the poster reads
// from theme tokens like every other themed surface.

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

export interface MoviePosterCardProps {
  movieId: number;
  title: string;
  posterPath: string | null;
  /** e.g. "1h 42m · Action" */
  subtitle?: string;
  /** e.g. "★ 7.4" — rendered as a photo-caption overlay in the top-left. */
  ratingBadge?: string;
  checkmark?: {
    isWatched: boolean;
    onPress: () => void;
  };
}

export default function MoviePosterCard({
  movieId,
  title,
  posterPath,
  subtitle,
  ratingBadge,
  checkmark,
}: MoviePosterCardProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View style={styles.wrap}>
      <PressableScale
        onPress={() => router.push(`/movie/${movieId}`)}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <View style={[styles.posterFrame, { backgroundColor: c.bgElevated }]}>
          <Image
            source={posterPath ? { uri: `${POSTER_BASE_URL}${posterPath}` } : undefined}
            style={styles.poster}
            contentFit="cover"
            transition={150}
          />

          {ratingBadge && (
            <View style={styles.overlayBadge}>
              <Text style={styles.overlayBadgeText} numberOfLines={1}>
                {ratingBadge}
              </Text>
            </View>
          )}

          {checkmark && (
            <PressableScale
              onPress={checkmark.onPress}
              hitSlop={8}
              style={styles.checkBtn}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checkmark.isWatched }}
              accessibilityLabel={checkmark.isWatched ? 'Mark as unwatched' : 'Mark as watched'}
            >
              <View
                style={[
                  styles.checkCircle,
                  checkmark.isWatched
                    ? { backgroundColor: c.accentFill, borderColor: c.accentFill }
                    : styles.checkCircleEmpty,
                ]}
              >
                {checkmark.isWatched && <Text style={[styles.checkMark, { color: c.onAccent }]}>✓</Text>}
              </View>
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
    </View>
  );
}

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
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#FFFFFF',
  },
  checkBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  checkCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleEmpty: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderColor: 'rgba(255,255,255,0.7)',
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
});
