// client-mobile/components/FollowButton.tsx
// Small pill toggle used on user rows, connections lists, and public
// profiles (Phase 74). Purely presentational + optimistic-toggle wiring —
// callers own the username and initial state; this owns the tap.

import { UserCheck, UserPlus } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { useAppTheme } from '../lib/theme';
import { useSocialStore } from '../store/socialStore';
import PressableScale from './PressableScale';

interface FollowButtonProps {
  username: string;
  isFollowing: boolean;
  size?: 'small' | 'medium';
}

export default function FollowButton({ username, isFollowing, size = 'medium' }: FollowButtonProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const toggleFollow = useSocialStore((s) => s.toggleFollow);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePress = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    await toggleFollow(username);
    setIsSubmitting(false);
  };

  const isSmall = size === 'small';

  return (
    <PressableScale
      onPress={handlePress}
      disabled={isSubmitting}
      style={[
        styles.button,
        isSmall && styles.buttonSmall,
        isFollowing
          ? { backgroundColor: 'transparent', borderColor: c.hairline, borderWidth: StyleSheet.hairlineWidth }
          : { backgroundColor: c.accentFill },
      ]}
      accessibilityRole="button"
      accessibilityLabel={isFollowing ? `Unfollow ${username}` : `Follow ${username}`}
    >
      {isSubmitting ? (
        <ActivityIndicator size="small" color={isFollowing ? c.textSecondary : c.onAccent} />
      ) : (
        <>
          {isFollowing ? (
            <UserCheck color={c.textSecondary} size={isSmall ? 13 : 15} strokeWidth={2.25} />
          ) : (
            <UserPlus color={c.onAccent} size={isSmall ? 13 : 15} strokeWidth={2.25} />
          )}
          <Text
            style={[
              isSmall ? styles.textSmall : styles.text,
              { color: isFollowing ? c.textSecondary : c.onAccent },
            ]}
          >
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    minWidth: 96,
  },
  buttonSmall: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 78,
  },
  text: {
    fontSize: 13,
    fontWeight: '700',
  },
  textSmall: {
    fontSize: 11,
    fontWeight: '700',
  },
});
