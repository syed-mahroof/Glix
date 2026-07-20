import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';
import { HistoryEntry } from '../store/watchStore';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function HistoryRow({ item }: { item: HistoryEntry }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const dateStr = new Date(item.watched_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <PressableScale
      style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
      onPress={() => router.push(`/show/${item.show_id}`)}
      accessibilityRole="button"
    >
      <Image
        source={item.show_poster_path ? { uri: `${POSTER_BASE_URL}${item.show_poster_path}` } : undefined}
        style={[styles.poster, { backgroundColor: c.bgElevated }]}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.textCol}>
        <Text style={[styles.showTitle, { color: c.textPrimary }]} numberOfLines={1}>
          {item.show_title}
        </Text>
        <Text style={[styles.episodeLabel, { color: c.accentInk }]} numberOfLines={1}>
          S{pad(item.episode.season_number)} · E{pad(item.episode.episode_number)}
        </Text>
        <Text style={[styles.episodeTitle, { color: c.textSecondary }]} numberOfLines={1}>
          {item.episode.title}
        </Text>
        <Text style={[styles.dateText, { color: c.textTertiary }]} numberOfLines={1}>
          Watched {dateStr}
        </Text>
      </View>
      
      <View style={[styles.checkCircle, { backgroundColor: c.accentFill, borderColor: c.accentFill }]}>
        <Text style={[styles.checkMark, { color: c.onAccent }]}>✓</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
    marginBottom: 8,
  },
  poster: {
    width: 54,
    height: 80,
    borderRadius: 10,
  },
  textCol: {
    flex: 1,
    gap: 3,
  },
  showTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  episodeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  episodeTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  dateText: {
    fontSize: 11,
    marginTop: 2,
  },
  checkCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
});
