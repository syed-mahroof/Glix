// client-mobile/components/UserRow.tsx
// Shared row for user search results and followers/following lists
// (Phase 74) — avatar, username, optional subtitle, FollowButton.

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import FollowButton from './FollowButton';
import PressableScale from './PressableScale';

interface UserRowProps {
  username: string;
  profilePicture: string | null;
  isFollowing: boolean;
  /** e.g. "Follows you" — omitted when there's nothing worth saying. */
  subtitle?: string;
  /** Hides the FollowButton entirely — used when the row represents the
   *  viewer's own account (search already excludes self, but connections
   *  lists can legitimately include it). */
  isSelf?: boolean;
}

export default function UserRow({ username, profilePicture, isFollowing, subtitle, isSelf }: UserRowProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <PressableScale
      style={[styles.row, { borderColor: c.hairline }]}
      onPress={() => router.push(`/user/${username}` as any)}
    >
      {profilePicture ? (
        <Image source={{ uri: profilePicture }} style={[styles.avatar, { backgroundColor: c.bgElevated }]} />
      ) : (
        <View style={[styles.avatarFallback, { backgroundColor: c.accentDim }]}>
          <Text style={[styles.avatarFallbackText, { color: c.accentInk }]}>
            {username.slice(0, 2).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.textColumn}>
        <Text style={[styles.username, { color: c.textPrimary }]} numberOfLines={1}>
          {username}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: c.textTertiary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {!isSelf && <FollowButton username={username} isFollowing={isFollowing} size="small" />}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 13,
    fontWeight: '800',
  },
  textColumn: {
    flex: 1,
  },
  username: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    marginTop: 1,
  },
});
