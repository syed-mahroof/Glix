// client-mobile/components/MVPVotingSheet.tsx
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
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
import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const PROFILE_BASE_URL = 'https://image.tmdb.org/t/p/w185';

interface CastMember {
  character_id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

export interface MVPVotingSheetProps {
  visible: boolean;
  episodeId: number | null;
  currentMvpCharacterId?: number | null;
  onClose: () => void;
  onVote: (characterId: number, characterName: string) => Promise<void> | void;
}

export function MVPVotingSheet({
  visible,
  episodeId,
  currentMvpCharacterId,
  onClose,
  onVote,
}: MVPVotingSheetProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [cast, setCast] = useState<CastMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [votingCharacterId, setVotingCharacterId] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || episodeId === null) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    api
      .get<CastMember[]>(`/episodes/${episodeId}/credits/`)
      .then((response) => {
        if (isMounted) setCast(response.data);
      })
      .catch((err) => {
        if (isMounted) setError(extractErrorMessage(err));
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [visible, episodeId]);

  const handleVote = async (member: CastMember) => {
    setVotingCharacterId(member.character_id);
    try {
      await onVote(member.character_id, member.character || member.name);
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setVotingCharacterId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={[styles.sheet, { backgroundColor: c.bg, borderColor: c.hairline }]} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Vote MVP</Text>
            <PressableScale onPress={onClose} hitSlop={8}>
              <X color={c.textPrimary} size={22} />
            </PressableScale>
          </View>

          {error && (
            <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
              <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
            </View>
          )}

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={c.accentInk} size="large" />
            </View>
          ) : cast.length === 0 ? (
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>No cast information available for this episode.</Text>
            </View>
          ) : (
            <FlatList
              data={cast}
              keyExtractor={(item) => String(item.character_id)}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => {
                const isCurrentMvp = item.character_id === currentMvpCharacterId;
                const isVotingThis = votingCharacterId === item.character_id;
                return (
                  <PressableScale
                    style={[
                      styles.castRow,
                      { backgroundColor: c.glassFill, borderColor: c.hairline },
                      isCurrentMvp && { borderColor: c.accentInk, backgroundColor: c.accentDim },
                    ]}
                    onPress={() => handleVote(item)}
                    disabled={votingCharacterId !== null}
                  >
                    <Image
                      source={
                        item.profile_path
                          ? { uri: `${PROFILE_BASE_URL}${item.profile_path}` }
                          : undefined
                      }
                      style={[styles.photo, { backgroundColor: c.bgElevated }]}
                      contentFit="cover"
                      transition={150}
                    />
                    <View style={styles.castTextColumn}>
                      <Text style={[styles.castCharacter, { color: c.textPrimary }]} numberOfLines={1}>
                        {item.character || 'Unknown Character'}
                      </Text>
                      <Text style={[styles.castName, { color: c.textSecondary }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    {isVotingThis ? (
                      <ActivityIndicator size="small" color={c.accentInk} />
                    ) : isCurrentMvp ? (
                      <View style={[styles.mvpBadge, { backgroundColor: c.accentFill }]}>
                        <Text style={[styles.mvpBadgeText, { color: c.onAccent }]}>MVP</Text>
                      </View>
                    ) : null}
                  </PressableScale>
                );
              }}
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
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 8,
  },
  castRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 8,
  },
  photo: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  castTextColumn: {
    flex: 1,
    gap: 2,
  },
  castCharacter: {
    fontSize: 13,
    fontWeight: '700',
  },
  castName: {
    fontSize: 11,
  },
  mvpBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mvpBadgeText: {
    fontSize: 10,
    fontWeight: '800',
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