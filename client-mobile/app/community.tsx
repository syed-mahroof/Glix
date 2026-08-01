// client-mobile/app/community.tsx
// Phase 74: restructured from a single comment aggregator into a hub with
// Discussions | Activity | People segments. Discussions keeps the original
// per-show comment aggregator body verbatim (it's the only part that
// worked before); Activity and People are new, backed by socialStore.
// Each segment fetches only when active — this screen already fires up to
// MAX_SHOWS_TO_QUERY parallel requests in Discussions alone.

import { useRouter } from 'expo-router';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActivityRow from '../components/ActivityRow';
import { CommentCard } from '../components/CommentCard';
import ErrorState from '../components/ErrorState';
import PressableScale from '../components/PressableScale';
import { CommentItem } from '../components/ReplyCard';
import { SegmentedControl } from '../components/SegmentedControl';
import UserRow from '../components/UserRow';
import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { useAppTheme } from '../lib/theme';
import { useSocialStore } from '../store/socialStore';
import { useWatchStore } from '../store/watchStore';

// No backend "global recent comments" endpoint exists — CommentListCreateView
// requires show_id/episode_id and returns nothing without either. This feed
// is built by fetching first-page comments per show in the user's watchlist
// (capped below) and merging client-side, sorted by recency.
const MAX_SHOWS_TO_QUERY = 8;

interface PaginatedComments {
  results: CommentItem[];
}

type Segment = 'discussions' | 'activity' | 'people';

function DiscussionsTab() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  // Scoped selectors, not a bare useWatchStore() — see app/_layout.tsx's note.
  const watchlist = useWatchStore((s) => s.watchlist);
  const fetchWatchlist = useWatchStore((s) => s.fetchWatchlist);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedShows.map((e) => e.show.tmdb_id).join(',')]);

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

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={c.accentInk} size="large" />
      </View>
    );
  }

  return (
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
  );
}

function ActivityTab() {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const activityFeed = useSocialStore((s) => s.activityFeed);
  const isLoadingFeed = useSocialStore((s) => s.isLoadingFeed);
  const hasMoreFeed = useSocialStore((s) => s.hasMoreFeed);
  const feedPage = useSocialStore((s) => s.feedPage);
  const error = useSocialStore((s) => s.error);
  const fetchActivityFeed = useSocialStore((s) => s.fetchActivityFeed);

  useEffect(() => {
    fetchActivityFeed(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoadingFeed && activityFeed.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={c.accentInk} size="large" />
      </View>
    );
  }

  if (error && activityFeed.length === 0) {
    return <ErrorState message={error} onRetry={() => fetchActivityFeed(1)} />;
  }

  return (
    <FlatList
      data={activityFeed}
      keyExtractor={(item, index) =>
        item.type === 'episodes' ? `ep-${item.user_id}-${item.show_id}-${item.watched_at}` : `mv-${item.user_id}-${item.movie_id}-${item.watched_at}-${index}`
      }
      contentContainerStyle={styles.list}
      refreshing={isLoadingFeed && activityFeed.length > 0}
      onRefresh={() => fetchActivityFeed(1)}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (hasMoreFeed && !isLoadingFeed) fetchActivityFeed(feedPage + 1);
      }}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>
            Follow people to see what they're watching here.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.cardWrap}>
          <ActivityRow card={item} />
        </View>
      )}
    />
  );
}

function PeopleTab() {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [query, setQuery] = useState('');
  const searchResults = useSocialStore((s) => s.searchResults);
  const isSearching = useSocialStore((s) => s.isSearching);
  const searchError = useSocialStore((s) => s.searchError);
  const searchUsers = useSocialStore((s) => s.searchUsers);
  const clearSearch = useSocialStore((s) => s.clearSearch);

  useEffect(() => {
    const handle = setTimeout(() => {
      searchUsers(query);
    }, 300);
    return () => clearTimeout(handle);
  }, [query, searchUsers]);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.searchBar, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
        <Search color={c.textTertiary} size={16} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people by username"
          placeholderTextColor={c.textTertiary}
          style={[styles.searchInput, { color: c.textPrimary }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <PressableScale
            onPress={() => {
              setQuery('');
              clearSearch();
            }}
            hitSlop={8}
          >
            <X color={c.textTertiary} size={16} />
          </PressableScale>
        )}
      </View>

      {isSearching && searchResults.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      ) : searchError ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>{searchError}</Text>
        </View>
      ) : (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <UserRow username={item.username} profilePicture={item.profile_picture} isFollowing={item.is_following} />
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                {query.trim().length < 2 ? 'Type at least 2 characters to search.' : 'No users found.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

export default function CommunityScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [segment, setSegment] = useState<Segment>('discussions');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Community</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.segmentWrap}>
        <SegmentedControl
          segments={[
            { value: 'discussions', label: 'Discussions' },
            { value: 'activity', label: 'Activity' },
            { value: 'people', label: 'People' },
          ]}
          selectedValue={segment}
          onValueChange={(v) => setSegment(v as Segment)}
        />
      </View>

      {segment === 'discussions' && <DiscussionsTab />}
      {segment === 'activity' && <ActivityTab />}
      {segment === 'people' && <PeopleTab />}
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
  segmentWrap: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
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
