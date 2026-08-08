// client-mobile/app/user/[username]/connections.tsx
// Followers / following list for a given username (Phase 74) —
// GET /users/<username>/followers/ or /following/, picked by ?tab=.

import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ErrorState from '../../../components/ErrorState';
import PressableScale from '../../../components/PressableScale';
import { SegmentedControl } from '../../../components/SegmentedControl';
import UserRow from '../../../components/UserRow';
import { useAppTheme } from '../../../lib/theme';
import { useSocialStore } from '../../../store/socialStore';

type Tab = 'followers' | 'following';

export default function ConnectionsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { username, tab: initialTab } = useLocalSearchParams<{ username: string; tab?: string }>();
  const [tab, setTab] = useState<Tab>(initialTab === 'following' ? 'following' : 'followers');

  const followers = useSocialStore((s) => (username ? s.followers[username.toLowerCase()] : undefined));
  const following = useSocialStore((s) => (username ? s.following[username.toLowerCase()] : undefined));
  const isLoadingConnections = useSocialStore((s) => s.isLoadingConnections);
  const error = useSocialStore((s) => s.error);
  const fetchFollowers = useSocialStore((s) => s.fetchFollowers);
  const fetchFollowing = useSocialStore((s) => s.fetchFollowing);

  useEffect(() => {
    if (!username) return;
    if (tab === 'followers') fetchFollowers(username);
    else fetchFollowing(username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, tab]);

  const data = tab === 'followers' ? followers : following;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
          @{username}
        </Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.segmentWrap}>
        <SegmentedControl
          segments={[
            { value: 'followers', label: 'Followers' },
            { value: 'following', label: 'Following' },
          ]}
          selectedValue={tab}
          onValueChange={(v) => setTab(v as Tab)}
        />
      </View>

      {isLoadingConnections && !data ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      ) : error && !data ? (
        <ErrorState message={error} onRetry={() => (tab === 'followers' ? fetchFollowers(username) : fetchFollowing(username))} />
      ) : (
        <FlashList
          data={data ?? []}
          keyExtractor={(item) => String(item.id)}
          estimatedItemSize={64}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <UserRow
              username={item.username}
              profilePicture={item.profile_picture}
              isFollowing={item.is_following}
              isSelf={item.is_self}
            />
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                {tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
              </Text>
            </View>
          }
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
    flex: 1,
    textAlign: 'center',
  },
  segmentWrap: {
    paddingHorizontal: 16,
    marginBottom: 8,
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
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
