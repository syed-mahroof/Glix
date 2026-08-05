// client-mobile/app/lists/[id].tsx
// Single custom list's contents — tap an item to open its full detail
// screen (movie or show, per media_type), or remove it from the list.

import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Film, Trash2, Tv2, X } from 'lucide-react-native';
import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassSurface from '../../components/GlassSurface';
import PressableScale from '../../components/PressableScale';
import { useAppTheme } from '../../lib/theme';
import { type CustomListItem, useListsStore } from '../../store/listsStore';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
const NUM_COLUMNS = 3;

export default function ListDetailScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { id } = useLocalSearchParams<{ id: string }>();
  const listId = Number(id);

  const activeListDetail = useListsStore((s) => s.activeListDetail);
  const isLoadingListDetail = useListsStore((s) => s.isLoadingListDetail);
  const fetchListDetail = useListsStore((s) => s.fetchListDetail);
  const deleteList = useListsStore((s) => s.deleteList);
  const toggleListItem = useListsStore((s) => s.toggleListItem);

  useEffect(() => {
    if (listId) fetchListDetail(listId);
  }, [listId, fetchListDetail]);

  const handleOpenItem = useCallback(
    (item: CustomListItem) => {
      router.push(item.media_type === 'movie' ? (`/movie/${item.tmdb_id}` as any) : (`/show/${item.tmdb_id}` as any));
    },
    [router]
  );

  const handleRemoveItem = useCallback(
    (item: CustomListItem) => {
      toggleListItem(listId, item.media_type, item.tmdb_id).then(() => fetchListDetail(listId));
    },
    [listId, toggleListItem, fetchListDetail]
  );

  const handleDeleteList = useCallback(() => {
    Alert.alert(
      'Delete List',
      `Delete "${activeListDetail?.name}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteList(listId);
            if (ok) router.back();
          },
        },
      ]
    );
  }, [activeListDetail, listId, deleteList, router]);

  const renderItem = ({ item }: { item: CustomListItem }) => (
    <View style={styles.itemWrap}>
      <PressableScale onPress={() => handleOpenItem(item)}>
        <View style={[styles.poster, { backgroundColor: c.bgElevated }]}>
          {item.poster_path ? (
            <Image
              source={{ uri: `${POSTER_BASE_URL}${item.poster_path}` }}
              style={styles.posterImg}
              contentFit="cover"
              recyclingKey={`${item.media_type}-${item.tmdb_id}`}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.posterFallback}>
              {item.media_type === 'movie' ? (
                <Film color={c.textTertiary} size={28} />
              ) : (
                <Tv2 color={c.textTertiary} size={28} />
              )}
            </View>
          )}
        </View>
      </PressableScale>
      <PressableScale
        style={[styles.removeBtn, { backgroundColor: c.bgElevated, borderColor: c.hairline }]}
        onPress={() => handleRemoveItem(item)}
        hitSlop={8}
        accessibilityLabel="Remove from list"
      >
        <X color={c.textSecondary} size={13} strokeWidth={2.5} />
      </PressableScale>
      <Text style={[styles.itemTitle, { color: c.textPrimary }]} numberOfLines={2}>
        {item.title}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={[styles.iconBtn, { backgroundColor: c.glassFill }]}>
          <ArrowLeft color={c.textPrimary} size={20} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
          {activeListDetail?.name ?? 'List'}
        </Text>
        <PressableScale onPress={handleDeleteList} hitSlop={8} style={[styles.iconBtn, { backgroundColor: c.glassFill }]}>
          <Trash2 color={c.negative} size={18} />
        </PressableScale>
      </View>

      {isLoadingListDetail && !activeListDetail ? (
        <ActivityIndicator color={c.accentInk} style={{ marginTop: 40 }} />
      ) : !activeListDetail || activeListDetail.items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>No items yet</Text>
          <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
            Open a movie or show and tap "Add to List" to file it here.
          </Text>
        </View>
      ) : (
        <FlashList
          data={activeListDetail.items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          numColumns={NUM_COLUMNS}
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
    gap: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 120,
  },
  itemWrap: {
    flex: 1 / NUM_COLUMNS,
    padding: 6,
  },
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  posterImg: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    lineHeight: 15,
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
