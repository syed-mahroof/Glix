// client-mobile/components/AvatarPickerModal.tsx
// Profile > EDIT avatar picker. Three pools (Phase 74: was two, "Cast"
// renamed "Characters" to match what it actually returns):
//   - "Characters": real TMDB character headshots via
//     GET /profile/avatar-options/ (AvatarOptionsView,
//     backend/core/profile_views.py) — top-billed cast from currently
//     trending shows/movies, labeled by in-show `character` name rather
//     than the actor's real name. TMDB has no dedicated character-portrait
//     asset (the photo is unavoidably the credited actor's headshot), so
//     this is the closest TMDB-backed approximation of "pick a character,"
//     per AI_RULES.md's "TMDB only via TMDBService" rule.
//   - "Cartoon": illustrated/animated-style avatars generated client-side
//     from a fixed seed list against DiceBear's public HTTP avatar API (no
//     API key, no new npm dependency — just image URLs expo-image renders
//     like any other remote photo).
//   - "Icons": abstract/geometric DiceBear styles (identicon, rings,
//     shapes, initials) for users who want something non-figurative.
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

const DICEBEAR_SEEDS = ['Nova', 'Pixel', 'Comet', 'Juniper', 'Orion', 'Sable', 'Quill', 'Ember'];

// Phase 74: expanded from 6 styles to a broader illustrated/animated set —
// none of these overlap with ICON_STYLES below, which is the abstract/
// geometric counterpart, not "more of the same."
const CARTOON_STYLES = [
  'avataaars',
  'croodles',
  'fun-emoji',
  'lorelei',
  'open-peeps',
  'personas',
  'pixel-art',
  'shapes',
  'bottts-neutral',
] as const;

const ICON_STYLES = ['identicon', 'rings', 'shapes', 'initials'] as const;

function buildDicebearAvatars(styles: readonly string[]): string[] {
  return styles.flatMap((style) =>
    DICEBEAR_SEEDS.map((seed) => `https://api.dicebear.com/9.x/${style}/png?seed=${style}-${seed}&size=128`)
  );
}

const CARTOON_AVATARS: string[] = buildDicebearAvatars(CARTOON_STYLES);
const ICON_AVATARS: string[] = buildDicebearAvatars(ICON_STYLES);

interface CastCharacter {
  character: string;
  show_title: string;
  profile_path: string;
}

type Tab = 'characters' | 'cartoon' | 'icons';

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
  const [tab, setTab] = useState<Tab>('characters');
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

  // Was a binary ternary (cast vs. one fixed cartoon list) — now a proper
  // map over 3 tabs so adding a 4th pool later is a one-line addition,
  // not another ternary branch.
  const data = useMemo<string[]>(() => {
    switch (tab) {
      case 'characters':
        return cast.map((p) => `${TMDB_PROFILE_BASE}${p.profile_path}`);
      case 'cartoon':
        return CARTOON_AVATARS;
      case 'icons':
        return ICON_AVATARS;
      default:
        return [];
    }
  }, [tab, cast]);

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
                { value: 'characters', label: 'Characters' },
                { value: 'cartoon', label: 'Cartoon' },
                { value: 'icons', label: 'Icons' },
              ]}
              selectedValue={tab}
              onValueChange={setTab}
            />
          </View>

          {tab === 'characters' && error ? (
            <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
              <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
            </View>
          ) : null}

          {tab === 'characters' && isLoading ? (
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
