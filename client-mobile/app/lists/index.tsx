// client-mobile/app/lists/index.tsx
// "My Lists" hub — user-created lists (e.g. "Movies2026"). Reached from
// three places (Phase 74): the Movies Hub header, the Shows Hub header,
// and a row on the Profile Hub. Lists are mixed-media (a single list can
// hold both shows and movies — see CustomListItem.media_type), so instead
// of splitting into two screens this hub gets an All/Shows/Movies filter.

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ListChecks, Lock, Plus } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassSurface from '../../components/GlassSurface';
import PressableScale from '../../components/PressableScale';
import { SegmentedControl } from '../../components/SegmentedControl';
import { useAppTheme } from '../../lib/theme';
import { type CustomListSummary, useListsStore } from '../../store/listsStore';

type MediaFilter = 'all' | 'tv' | 'movie';

const MEDIA_FILTERS: { value: MediaFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tv', label: 'Shows' },
  { value: 'movie', label: 'Movies' },
];

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w200';

function CoverCollage({ posters }: { posters: string[] }) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  if (posters.length === 0) {
    return (
      <View style={[styles.collageEmpty, { backgroundColor: c.glassFill }]}>
        <ListChecks color={c.textTertiary} size={28} strokeWidth={1.5} />
      </View>
    );
  }

  return (
    <View style={styles.collage}>
      {posters.slice(0, 4).map((path, idx) => (
        <Image
          key={`${path}-${idx}`}
          source={{ uri: `${POSTER_BASE_URL}${path}` }}
          style={[styles.collagePoster, { backgroundColor: c.bgElevated }]}
          contentFit="cover"
        />
      ))}
    </View>
  );
}

function ListCard({ item }: { item: CustomListSummary }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <PressableScale onPress={() => router.push(`/lists/${item.id}` as any)}>
      <GlassSurface radius={16} style={styles.card}>
        <CoverCollage posters={item.cover_posters} />
        <View style={styles.cardInfo}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: c.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.is_private && <Lock color={c.textTertiary} size={13} />}
          </View>
          <Text style={[styles.cardCount, { color: c.textSecondary }]}>
            {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
          </Text>
        </View>
      </GlassSurface>
    </PressableScale>
  );
}

export default function ListsHubScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  // Arriving from the Shows Hub / Movies Hub's own list button seeds the
  // filter from ?media=tv|movie so "my shows' lists" opens already scoped
  // to shows, instead of always defaulting to All regardless of where the
  // user tapped in from (Phase 75.4). Any other/missing value falls back
  // to 'all' — the Profile Hub's "My Lists" row links here with no param.
  const { media } = useLocalSearchParams<{ media?: string }>();
  const initialMediaFilter: MediaFilter = media === 'tv' || media === 'movie' ? media : 'all';

  const lists = useListsStore((s) => s.lists);
  const listsFetchedAt = useListsStore((s) => s.listsFetchedAt);
  const isLoadingLists = useListsStore((s) => s.isLoadingLists);
  const fetchLists = useListsStore((s) => s.fetchLists);
  const createList = useListsStore((s) => s.createList);

  // C13 stale-while-revalidate: `lists` can now paint immediately from a
  // persisted snapshot on a cold start (store/listsStore.ts) while
  // fetchLists()'s always-fires-on-mount call below revalidates it in the
  // background — flag it rather than silently presenting a stale hub.
  const isRevalidatingStaleSnapshot =
    isLoadingLists &&
    lists.length > 0 &&
    listsFetchedAt !== null &&
    Date.now() - listsFetchedAt > 30 * 60 * 1000;

  const [newListName, setNewListName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>(initialMediaFilter);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const filteredLists = useMemo(() => {
    if (mediaFilter === 'all') return lists;
    return lists.filter((l) => (mediaFilter === 'tv' ? l.tv_count > 0 : l.movie_count > 0));
  }, [lists, mediaFilter]);

  const handleCreate = useCallback(async () => {
    const name = newListName.trim();
    if (!name) return;
    setIsCreating(true);
    const created = await createList(name);
    setIsCreating(false);
    if (created) setNewListName('');
  }, [newListName, createList]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={[styles.backBtn, { backgroundColor: c.glassFill }]}>
          <ArrowLeft color={c.textPrimary} size={20} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>My Lists</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={[styles.createRow, { borderColor: c.hairline }]}>
        <TextInput
          style={[styles.createInput, { color: c.textPrimary }]}
          placeholder="New list name…"
          placeholderTextColor={c.textTertiary}
          value={newListName}
          onChangeText={setNewListName}
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={handleCreate}
        />
        <PressableScale
          style={[styles.createBtn, { backgroundColor: c.accentFill }, !newListName.trim() && styles.createBtnDisabled]}
          onPress={handleCreate}
          disabled={!newListName.trim() || isCreating}
        >
          {isCreating ? <ActivityIndicator color={c.onAccent} size="small" /> : <Plus color={c.onAccent} size={18} strokeWidth={2.5} />}
        </PressableScale>
      </View>

      {lists.length > 0 && (
        <View style={styles.filterRow}>
          <SegmentedControl segments={MEDIA_FILTERS} selectedValue={mediaFilter} onValueChange={setMediaFilter} />
        </View>
      )}

      {isRevalidatingStaleSnapshot && (
        <View style={styles.updatingBadge}>
          <ActivityIndicator size="small" color={c.textTertiary} />
          <Text style={[styles.updatingText, { color: c.textTertiary }]}>Updating…</Text>
        </View>
      )}

      {isLoadingLists && lists.length === 0 ? (
        <ActivityIndicator color={c.accentInk} style={{ marginTop: 40 }} />
      ) : lists.length === 0 ? (
        <View style={styles.emptyState}>
          <ListChecks color={c.textTertiary} size={48} strokeWidth={1.5} />
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>No lists yet</Text>
          <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
            Create a list above, or tap "Add to List" from any show or movie to start one.
          </Text>
        </View>
      ) : filteredLists.length === 0 ? (
        <View style={styles.emptyState}>
          <ListChecks color={c.textTertiary} size={48} strokeWidth={1.5} />
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>
            No {mediaFilter === 'tv' ? 'show' : 'movie'} lists yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
            Lists with a {mediaFilter === 'tv' ? 'show' : 'movie'} in them will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredLists}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ListCard item={item} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
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
  filterRow: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  updatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 12,
  },
  updatingText: {
    fontSize: 12,
    fontWeight: '600',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    marginHorizontal: 20,
    marginBottom: 16,
  },
  createInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
  },
  createBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {
    opacity: 0.4,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 14,
  },
  collage: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  collagePoster: {
    width: 32,
    height: 32,
  },
  collageEmpty: {
    width: 64,
    height: 64,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  cardCount: {
    fontSize: 13,
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
