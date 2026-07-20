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

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
  };
}

export default function ShowPosterCard({
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
              onPress={checkmark.onPress}
              disabled={checkmark.disabled}
              hitSlop={8}
              style={[styles.checkBtn, checkmark.disabled && styles.checkBtnDisabled]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checkmark.isWatched, disabled: checkmark.disabled }}
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
