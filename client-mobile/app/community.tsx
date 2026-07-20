// client-mobile/app/community.tsx
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CommentCard } from '../components/CommentCard';
import PressableScale from '../components/PressableScale';
import { CommentItem } from '../components/ReplyCard';
import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { useAppTheme } from '../lib/theme';
import { useWatchStore } from '../store/watchStore';

// No backend "global recent comments" endpoint exists — CommentListCreateView
// requires show_id/episode_id and returns nothing without either. This feed
// is built by fetching first-page comments per show in the user's watchlist
// (capped below) and merging client-side, sorted by recency.
const MAX_SHOWS_TO_QUERY = 8;

interface PaginatedComments {
  results: CommentItem[];
}

export default function CommunityScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { watchlist, fetchWatchlist } = useWatchStore();

  const [feed, setFeed] = useState<CommentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackedShows = [
    ...watchlist.to_watch.results,
    ...watchlist.up_to_date.results,
    ...watchlist.archived.results,
  ].slice(0, MAX_SHOWS_TO_QUERY);

  const loadFeed = useCallback(async () => {
    setError(null);
    if (trackedShows.length === 0) {
      setFeed([]);
      setIsLoading(false);
      return;
    }

    const results = await Promise.allSettled(
      trackedShows.map((entry) =>
        api.get<PaginatedComments>('/comments/', {
          params: { show_id: entry.show.tmdb_id, page: 1 },
        })
      )
    );

    const merged: CommentItem[] = [];
    let allFailed = true;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allFailed = false;
        merged.push(...result.value.data.results);
      }
    }

    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setFeed(merged);

    if (allFailed && trackedShows.length > 0) {
      setError(extractErrorMessage((results[0] as PromiseRejectedResult).reason));
    }
    setIsLoading(false);
  }, [trackedShows]);

  useEffect(() => {
    fetchWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchWatchlist();
    await loadFeed();
    setIsRefreshing(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Community</Text>
        <View style={styles.iconButton} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          ListHeaderComponent={
            error ? (
              <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
                <Text style={[styles.errorBannerText, { color: c.negative }]}>{error}</Text>
              </View>
            ) : trackedShows.length === 0 ? null : (
              <Text style={[styles.subtitle, { color: c.textSecondary }]}>
                Recent comments from the {trackedShows.length} show{trackedShows.length === 1 ? '' : 's'}{' '}
                you're tracking
              </Text>
            )
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                {trackedShows.length === 0
                  ? 'Add shows to your watchlist to see their discussions here.'
                  : 'No comments yet on your tracked shows.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <CommentCard
                comment={item}
                onPress={() => item.show && router.push(`/show/${item.show}/comments`)}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  subtitle: {
    fontSize: 12,
    marginBottom: 14,
  },
  cardWrap: {
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorBanner: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorBannerText: {
    fontSize: 12,
  },
});
