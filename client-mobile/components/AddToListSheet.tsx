// client-mobile/components/AddToListSheet.tsx
// "Add to List" bottom sheet — lets the user file a movie/show into any of
// their own custom lists (e.g. "Movies2026"), or quick-create a new one.
// Same backdrop/translateY/handle spring-sheet mechanics as
// WatchlistFilterSheet.tsx/DiscoverFilterSheet, not a new sheet mechanism.
// Ultra-dark-glass + neon-yellow tokens only — no purple/blue.

import { BlurView } from 'expo-blur';
import { CheckCircle, Circle, Lock, Plus, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';
import { type MediaType, useListsStore } from '../store/listsStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.6;

interface Props {
  visible: boolean;
  onClose: () => void;
  mediaType: MediaType;
  tmdbId: number;
}

export default function AddToListSheet({ visible, onClose, mediaType, tmdbId }: Props) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();

  const lists = useListsStore((s) => s.lists);
  const isLoadingLists = useListsStore((s) => s.isLoadingLists);
  const membership = useListsStore((s) => s.membership);
  const fetchLists = useListsStore((s) => s.fetchLists);
  const fetchMembership = useListsStore((s) => s.fetchMembership);
  const toggleListItem = useListsStore((s) => s.toggleListItem);
  const createList = useListsStore((s) => s.createList);

  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const memberIds = membership[`${mediaType}:${tmdbId}`] ?? [];

  useEffect(() => {
    if (visible) {
      fetchLists();
      fetchMembership(mediaType, tmdbId);
    }
  }, [visible, mediaType, tmdbId, fetchLists, fetchMembership]);

  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      backdropOpacity.value = withSpring(1, { damping: 20 });
    } else {
      translateY.value = withSpring(SHEET_HEIGHT, { damping: 22, stiffness: 250 });
      backdropOpacity.value = withSpring(0, { damping: 22 });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0 ? 'auto' : 'none',
  }));

  const handleToggle = async (listId: number) => {
    setTogglingId(listId);
    await toggleListItem(listId, mediaType, tmdbId);
    setTogglingId(null);
  };

  const handleCreate = async () => {
    const name = newListName.trim();
    if (!name) return;
    setIsCreating(true);
    const created = await createList(name);
    setIsCreating(false);
    if (created) {
      setNewListName('');
      await toggleListItem(created.id, mediaType, tmdbId);
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'box-none' : 'none'}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { borderColor: c.hairline }, sheetStyle]}>
        <BlurView intensity={90} tint={theme.blurTint} style={[StyleSheet.absoluteFill, styles.sheetClip]} />
        <View style={[StyleSheet.absoluteFill, styles.sheetClip, { backgroundColor: c.glassFillStrong }]} />
        <View style={[styles.handle, { backgroundColor: c.hairline }]} />

        <View style={[styles.sheetHeader, { borderBottomColor: c.hairline }]}>
          <Text style={[styles.sheetTitle, { color: c.textPrimary }]}>Add to List</Text>
          <PressableScale onPress={onClose} style={[styles.closeBtn, { backgroundColor: c.glassFill }]} hitSlop={12}>
            <X color={c.textSecondary} size={20} strokeWidth={2} />
          </PressableScale>
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator
          persistentScrollbar
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + insets.bottom }]}
        >
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
              {isCreating ? (
                <ActivityIndicator color={c.onAccent} size="small" />
              ) : (
                <Plus color={c.onAccent} size={18} strokeWidth={2.5} />
              )}
            </PressableScale>
          </View>

          {isLoadingLists && lists.length === 0 ? (
            <ActivityIndicator color={c.accentInk} style={{ marginTop: 24 }} />
          ) : lists.length === 0 ? (
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>
              No lists yet. Create one above to start organizing.
            </Text>
          ) : (
            lists.map((list) => {
              const isMember = memberIds.includes(list.id);
              const isBusy = togglingId === list.id;
              return (
                <PressableScale
                  key={list.id}
                  style={[styles.listRow, { borderColor: c.hairline }]}
                  onPress={() => handleToggle(list.id)}
                  disabled={isBusy}
                >
                  <View style={styles.listRowLeft}>
                    <Text style={[styles.listName, { color: c.textPrimary }]} numberOfLines={1}>
                      {list.name}
                    </Text>
                    {list.is_private && <Lock color={c.textTertiary} size={12} />}
                    <Text style={[styles.listCount, { color: c.textTertiary }]}>{list.item_count}</Text>
                  </View>
                  {isBusy ? (
                    <ActivityIndicator color={c.accentInk} size="small" />
                  ) : isMember ? (
                    <CheckCircle color={c.accentInk} size={22} fill={c.accentDim} />
                  ) : (
                    <Circle color={c.textTertiary} size={22} />
                  )}
                </PressableScale>
              );
            })
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  sheetClip: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
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
    marginBottom: 20,
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
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 20,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  listName: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  listCount: {
    fontSize: 12,
    fontWeight: '600',
  },
});
