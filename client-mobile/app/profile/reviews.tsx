// client-mobile/app/profile/reviews.tsx
// "My Reviews" (Phase 74) — every rating/note the user has left, across
// shows and movies. GET /reviews/shows/ and /reviews/movies/ existed
// since Phase L (paginated via StandardResultsPagination) but had zero
// consumers until now — AI_RULES §5 calls out unreachable features as a
// repeat failure mode in this repo, and this closes that gap.

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft, NotebookPen } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassSurface from '../../components/GlassSurface';
import PressableScale from '../../components/PressableScale';
import { SegmentedControl } from '../../components/SegmentedControl';
import StarRatingDisplay from '../../components/StarRatingDisplay';
import { api } from '../../lib/api';
import { extractErrorMessage } from '../../lib/errors';
import { useAppTheme } from '../../lib/theme';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

type Tab = 'shows' | 'movies';

interface ShowReview {
  id: string;
  show_id: number;
  show_title: string;
  show_poster_path: string | null;
  rating: number;
  note: string;
  updated_at: string;
}

interface MovieReview {
  id: string;
  movie_id: number;
  movie_title: string;
  movie_poster_path: string | null;
  rating: number;
  note: string;
  updated_at: string;
}

// Normalized shape the list/row renders — collapses the two API shapes
// above into one, since they only ever differ by field name prefix.
interface ReviewRow {
  id: string;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  rating: number;
  note: string;
  updatedAt: string;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  results: T[];
}

function toRow(tab: Tab, item: ShowReview | MovieReview): ReviewRow {
  if (tab === 'shows') {
    const r = item as ShowReview;
    return { id: r.id, tmdbId: r.show_id, title: r.show_title, posterPath: r.show_poster_path, rating: r.rating, note: r.note, updatedAt: r.updated_at };
  }
  const r = item as MovieReview;
  return { id: r.id, tmdbId: r.movie_id, title: r.movie_title, posterPath: r.movie_poster_path, rating: r.rating, note: r.note, updatedAt: r.updated_at };
}

function ReviewRowCard({ tab, item }: { tab: Tab; item: ReviewRow }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <PressableScale onPress={() => router.push(`/${tab === 'shows' ? 'show' : 'movie'}/${item.tmdbId}` as any)}>
      <GlassSurface radius={16} style={styles.row}>
        <Image
          source={item.posterPath ? { uri: `${POSTER_BASE_URL}${item.posterPath}` } : undefined}
          style={[styles.poster, { backgroundColor: c.bgElevated }]}
          contentFit="cover"
          transition={150}
        />
        <View style={styles.rowInfo}>
          <Text style={[styles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
            {item.title}
          </Text>
          <StarRatingDisplay rating={item.rating} size={13} color={c.accentInk} inactiveColor={c.textTertiary} />
          {item.note ? (
            <Text style={[styles.rowNote, { color: c.textSecondary }]} numberOfLines={2}>
              {item.note}
            </Text>
          ) : null}
        </View>
      </GlassSurface>
    </PressableScale>
  );
}

export default function MyReviewsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const [tab, setTab] = useState<Tab>('shows');
  const [rowsByTab, setRowsByTab] = useState<Record<Tab, ReviewRow[]>>({ shows: [], movies: [] });
  const [hasMoreByTab, setHasMoreByTab] = useState<Record<Tab, boolean>>({ shows: false, movies: false });
  const [pageByTab, setPageByTab] = useState<Record<Tab, number>>({ shows: 1, movies: 1 });
  const [loadedByTab, setLoadedByTab] = useState<Record<Tab, boolean>>({ shows: false, movies: false });
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // page-number pagination (not following the raw `next` URL) — same
  // convention as watchStore.ts's fetchHistory, which sidesteps a real
  // footgun: DRF's `next` is an absolute URL built from the *backend's*
  // request host, which can differ from what the mobile client actually
  // connects to in dev (LAN IP vs tunnel vs EXPO_PUBLIC_API_URL).
  const load = useCallback(async (activeTab: Tab, page: number) => {
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    setError(null);
    try {
      const endpoint = activeTab === 'shows' ? '/reviews/shows/' : '/reviews/movies/';
      const res = await api.get<PaginatedResponse<ShowReview | MovieReview>>(endpoint, { params: { page } });
      const newRows = res.data.results.map((item) => toRow(activeTab, item));
      setRowsByTab((prev) => ({
        ...prev,
        [activeTab]: page === 1 ? newRows : [...prev[activeTab], ...newRows],
      }));
      setHasMoreByTab((prev) => ({ ...prev, [activeTab]: res.data.next !== null }));
      setPageByTab((prev) => ({ ...prev, [activeTab]: page }));
      setLoadedByTab((prev) => ({ ...prev, [activeTab]: true }));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!loadedByTab[tab]) load(tab, 1);
  }, [tab, loadedByTab, load]);

  const handleLoadMore = useCallback(() => {
    if (!hasMoreByTab[tab] || isLoadingMore) return;
    load(tab, pageByTab[tab] + 1);
  }, [tab, hasMoreByTab, pageByTab, isLoadingMore, load]);

  const rows = rowsByTab[tab];
  const isEmpty = !isLoading && loadedByTab[tab] && rows.length === 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={[styles.backBtn, { backgroundColor: c.glassFill }]}>
          <ArrowLeft color={c.textPrimary} size={20} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>My Reviews</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.tabsRow}>
        <SegmentedControl
          segments={[
            { value: 'shows', label: 'Shows' },
            { value: 'movies', label: 'Movies' },
          ]}
          selectedValue={tab}
          onValueChange={setTab}
        />
      </View>

      {error && (
        <PressableScale
          style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}
          onPress={() => setError(null)}
        >
          <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
        </PressableScale>
      )}

      {isLoading && rows.length === 0 ? (
        <ActivityIndicator color={c.accentInk} style={{ marginTop: 40 }} />
      ) : isEmpty ? (
        <View style={styles.emptyState}>
          <NotebookPen color={c.textTertiary} size={48} strokeWidth={1.5} />
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>
            No {tab === 'shows' ? 'show' : 'movie'} reviews yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
            Rate a {tab === 'shows' ? 'show' : 'movie'} from its detail page and it'll show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ReviewRowCard tab={tab} item={item} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={handleLoadMore}
          ListFooterComponent={isLoadingMore ? <ActivityIndicator color={c.accentInk} style={{ marginVertical: 16 }} /> : null}
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
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  tabsRow: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { fontSize: 13 },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  poster: {
    width: 56,
    height: 84,
    borderRadius: 10,
  },
  rowInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  rowNote: {
    fontSize: 12,
    lineHeight: 17,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
