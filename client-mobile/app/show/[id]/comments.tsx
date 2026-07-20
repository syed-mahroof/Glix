// client-mobile/app/show/[id]/comments.tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CommentCard } from '../../../components/CommentCard';
import { CommentComposer } from '../../../components/CommentComposer';
import PressableScale from '../../../components/PressableScale';
import { CommentItem } from '../../../components/ReplyCard';
import { ReactionSummary } from '../../../components/ReactionSummary';
import { api } from '../../../lib/api';
import { extractErrorMessage } from '../../../lib/errors';
import { useAppTheme } from '../../../lib/theme';

interface PaginatedComments {
  count: number;
  total_pages: number;
  current_page: number;
  next: string | null;
  previous: string | null;
  results: CommentItem[];
}

export default function ShowCommentsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { id } = useLocalSearchParams<{ id: string }>();
  const showId = Number(id);

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    if (Number.isNaN(showId)) {
      setError('Invalid show id.');
      setIsLoading(false);
      return;
    }
    setError(null);
    try {
      const response = await api.get<PaginatedComments>('/comments/', {
        params: { show_id: showId, page: 1 },
      });
      setComments(response.data.results);
      setTotalCount(response.data.count);
      setNextPage(response.data.next ? 2 : null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [showId]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadFirstPage();
    setIsRefreshing(false);
  };

  const handleLoadMore = async () => {
    if (nextPage === null || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await api.get<PaginatedComments>('/comments/', {
        params: { show_id: showId, page: nextPage },
      });
      setComments((prev) => [...prev, ...response.data.results]);
      setNextPage(response.data.next ? nextPage + 1 : null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handlePostComment = async (body: string, isSpoiler: boolean) => {
    const response = await api.post<CommentItem>('/comments/', {
      show: showId,
      body,
      is_spoiler: isSpoiler,
    });
    setComments((prev) => [response.data, ...prev]);
    setTotalCount((prev) => prev + 1);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Comments</Text>
        <View style={styles.iconButton} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          onEndReachedThreshold={0.4}
          onEndReached={handleLoadMore}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <ReactionSummary commentCount={totalCount} />
              {error && (
                <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
                  <Text style={[styles.errorBannerText, { color: c.negative }]}>{error}</Text>
                </View>
              )}
              <CommentComposer onSubmit={handlePostComment} placeholder="Share your thoughts..." />
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>No comments yet. Be the first.</Text>
            </View>
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={c.accentInk} size="small" />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <CommentCard comment={item} />
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
    paddingVertical: 40,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  listHeader: {
    gap: 12,
    marginBottom: 16,
  },
  cardWrap: {
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  errorBanner: {
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorBannerText: {
    fontSize: 12,
  },
});