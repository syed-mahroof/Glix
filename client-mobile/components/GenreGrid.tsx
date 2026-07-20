// client-mobile/components/GenreGrid.tsx
// "Browse by Genre" tiles at the bottom of the curated Discover feed.
//
// Fixed two real bugs:
//  1. Segment-unaware: always showed a movie-only genre list (e.g.
//     Horror=27) regardless of whether the user was on the Shows or
//     Movies segment — tapping it on the Shows segment would send an
//     invalid genre id to the TV discover endpoint. Now uses the same
//     TV_GENRES/MOVIE_GENRES lists (lib/genres.ts) the Filter & Sort
//     sheet already uses correctly.
//  2. Dead tap target: routed to `/search?genre=X`, a param app/search.tsx
//     never reads — silently landed on a blank search screen. Now calls
//     `onSelectGenre` (wired to discoverStore.setSelectedGenreId in
//     discover.tsx), the same store action the Filter & Sort sheet uses,
//     so tapping a tile actually filters the Discover feed.
//
// Also replaced the hand-typed, partially-stale TMDB image paths (several
// genres rendered as blank cards — the paths simply didn't resolve) with
// real cover images fetched via discoverStore.fetchGenreCovers(), and
// switched from RN's built-in Image to expo-image per AI_RULES.md §1.

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';

import PressableScale from './PressableScale';
import { MOVIE_GENRES, TV_GENRES } from '../lib/genres';
import { useAppTheme } from '../lib/theme';
import { ActiveSegment, useDiscoverStore } from '../store/discoverStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

interface GenreGridProps {
  activeSegment: ActiveSegment;
  onSelectGenre: (genreId: number) => void;
}

export default function GenreGrid({ activeSegment, onSelectGenre }: GenreGridProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const genres = activeSegment === 'tv' ? TV_GENRES : MOVIE_GENRES;
  const covers = useDiscoverStore((state) => state.genreCovers[activeSegment]);

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: c.textPrimary }]}>Browse by Genre</Text>
      <View style={styles.grid}>
        {genres.map((genre) => {
          const cover = covers[genre.id];
          const imagePath = cover?.backdrop_path || cover?.poster_path || null;

          return (
            <PressableScale
              key={genre.id}
              style={[
                styles.card,
                { backgroundColor: c.glassFill, borderColor: c.hairline },
                !imagePath && { backgroundColor: genre.color },
              ]}
              onPress={() => onSelectGenre(genre.id)}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${genre.name}`}
            >
              {imagePath && (
                <Image
                  source={{ uri: `${IMAGE_BASE_URL}${imagePath}` }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={200}
                />
              )}
              <LinearGradient
                colors={
                  imagePath
                    ? ['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.85)']
                    : ['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.45)']
                }
                style={StyleSheet.absoluteFillObject}
              />
              <Text style={styles.genreText}>{genre.name}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const SPACING = 16;
const NUM_COLUMNS = 2;
const CARD_WIDTH = (SCREEN_WIDTH - 40 - SPACING) / NUM_COLUMNS;

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    marginBottom: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: SPACING,
    paddingBottom: 120, // Tab bar padding
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 0.6,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genreText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});
