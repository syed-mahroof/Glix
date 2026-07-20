// client-mobile/components/AvatarPickerModal.tsx
// Profile > EDIT avatar picker. Two pools:
//   - "Cast": real TMDB character headshots via GET /profile/avatar-options/
//     (AvatarOptionsView, backend/core/profile_views.py) — top-billed cast
//     from currently trending shows/movies, labeled by in-show `character`
//     name rather than the actor's real name. TMDB has no dedicated
//     character-portrait asset (the photo is unavoidably the credited
//     actor's headshot), so this is the closest TMDB-backed approximation
//     of "pick a character," per AI_RULES.md's "TMDB only via TMDBService"
//     rule.
//   - "Cartoon": illustrated/anime-leaning avatars generated client-side from
//     a fixed seed list against DiceBear's public HTTP avatar API (no API
//     key, no new npm dependency — just image URLs expo-image renders like
//     any other remote photo).
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';
import { SegmentedControl } from './SegmentedControl';

const TMDB_PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

const CARTOON_STYLES = ['adventurer', 'micah', 'notionists', 'bottts', 'thumbs', 'big-smile'] as const;
const CARTOON_SEEDS = ['Nova', 'Pixel', 'Comet', 'Juniper', 'Orion', 'Sable', 'Quill', 'Ember'];

const CARTOON_AVATARS: string[] = CARTOON_STYLES.flatMap((style) =>
  CARTOON_SEEDS.map(
    (seed) => `https://api.dicebear.com/9.x/${style}/png?seed=${style}-${seed}&size=128`
  )
);

interface CastCharacter {
  character: string;
  show_title: string;
  profile_path: string;
}

type Tab = 'cast' | 'cartoon';

interface AvatarPickerModalProps {
  visible: boolean;
  currentAvatar: string | null;
  onClose: () => void;
  onSelect: (url: string) => void;
}

export default function AvatarPickerModal({
  visible,
  currentAvatar,
  onClose,
  onSelect,
}: AvatarPickerModalProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [tab, setTab] = useState<Tab>('cast');
  const [cast, setCast] = useState<CastCharacter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || cast.length > 0) return;
    setIsLoading(true);
    setError(null);
    api
      .get<{ cast: CastCharacter[] }>('/profile/avatar-options/')
      .then((res) => setCast(res.data.cast))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, [visible, cast.length]);

  const data = useMemo<string[]>(
    () =>
      tab === 'cast'
        ? cast.map((p) => `${TMDB_PROFILE_BASE}${p.profile_path}`)
        : CARTOON_AVATARS,
    [tab, cast]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={[styles.sheet, { backgroundColor: c.bg, borderColor: c.hairline }]} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Choose Avatar</Text>
            <PressableScale onPress={onClose} hitSlop={8}>
              <X color={c.textPrimary} size={22} />
            </PressableScale>
          </View>

          <View style={styles.tabsRow}>
            <SegmentedControl<Tab>
              segments={[
                { value: 'cast', label: 'Cast' },
                { value: 'cartoon', label: 'Cartoon' },
              ]}
              selectedValue={tab}
              onValueChange={setTab}
            />
          </View>

          {tab === 'cast' && error ? (
            <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
              <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
            </View>
          ) : null}

          {tab === 'cast' && isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={c.accentInk} size="large" />
            </View>
          ) : (
            <FlatList
              key={tab}
              data={data}
              keyExtractor={(uri) => uri}
              numColumns={4}
              contentContainerStyle={styles.grid}
              renderItem={({ item: uri }) => {
                const isSelected = uri === currentAvatar;
                return (
                  <PressableScale
                    style={styles.avatarCell}
                    onPress={() => onSelect(uri)}
                    hitSlop={4}
                  >
                    <Image
                      source={{ uri }}
                      style={[
                        styles.avatarImg,
                        { borderColor: isSelected ? c.accentInk : c.hairline, borderWidth: isSelected ? 2.5 : 1 },
                      ]}
                      contentFit="cover"
                      transition={150}
                    />
                  </PressableScale>
                );
              }}
              ListEmptyComponent={
                !isLoading ? (
                  <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                    No avatars available right now.
                  </Text>
                ) : null
              }
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  tabsRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  grid: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  avatarCell: {
    width: '25%',
    aspectRatio: 1,
    padding: 6,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
  centered: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: {
    fontSize: 12,
  },
});
