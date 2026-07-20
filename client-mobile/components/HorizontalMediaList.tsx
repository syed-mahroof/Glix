// client-mobile/components/HorizontalMediaList.tsx
// FlashList-backed horizontal poster row for the Discover Hub's feed sections.

import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

export interface MediaItem {
  tmdb_id: number;
  media_type: 'tv' | 'movie';
  title: string;
  poster_path: string | null;
  vote_average: number;
  // Optional — forwarded to the detail screen's optimistic fallback when
  // present (see HeroCarousel.tsx for the same reasoning); not every
  // caller has these, so the detail screen still degrades gracefully
  // without them.
  backdrop_path?: string | null;
  overview?: string;
}

interface Props {
  title: string;
  items: MediaItem[];
}

export default function HorizontalMediaList({ title, items }: Props) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  if (!items || items.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: c.textPrimary }]}>{title}</Text>
      <View style={{ minHeight: 250 }}>
        <FlashList
          data={items}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
          estimatedItemSize={142} // 130 + 12 marginRight
          renderItem={({ item }) => {
            const params = {
              title: item.title,
              poster_path: item.poster_path || '',
              vote_average: item.vote_average.toString(),
              backdrop_path: item.backdrop_path || '',
              overview: item.overview || '',
            };
            return (
              <PressableScale
                style={styles.card}
                onPress={() => {
                  if (item.media_type === 'movie') {
                    router.push({ pathname: `/movie/${item.tmdb_id}` as any, params });
                  } else {
                    router.push({ pathname: `/show/${item.tmdb_id}` as any, params });
                  }
                }}
              >
                <View
                  style={[
                    styles.posterContainer,
                    { backgroundColor: c.glassFill, borderColor: c.hairline },
                  ]}
                >
                  <Image
                    source={item.poster_path ? { uri: `${POSTER_BASE_URL}${item.poster_path}` } : undefined}
                    style={styles.poster}
                    contentFit="cover"
                    transition={200}
                  />
                  {/* Rating badge bottom-left — sits on the poster photo itself,
                      so it keeps a fixed dark scrim in both themes (same as
                      SearchResultCard's rating badge). */}
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingText}>★ {item.vote_average.toFixed(1)}</Text>
                  </View>
                </View>
                <Text style={[styles.mediaTitle, { color: c.textPrimary }]} numberOfLines={2}>
                  {item.title}
                </Text>
              </PressableScale>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  card: {
    width: 130,
    gap: 8,
    marginRight: 12,
  },
  posterContainer: {
    width: 130,
    height: 195,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  ratingBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  // Gold rating star — pre-existing non-token color, unrelated to light/dark
  // (same precedent as profile/movies.tsx's rating style and its "watched" green).
  ratingText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '800',
  },
  mediaTitle: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
});
