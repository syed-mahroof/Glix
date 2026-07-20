// client-mobile/components/LikeButton.tsx
import { Heart } from 'lucide-react-native';
import React, { memo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

export interface LikeButtonProps {
  liked: boolean;
  count: number;
  onToggle: () => Promise<void> | void;
  disabled?: boolean;
  size?: number;
}

function LikeButtonComponent({ liked, count, onToggle, disabled = false, size = 15 }: LikeButtonProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePress = async () => {
    if (disabled || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onToggle();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PressableScale onPress={handlePress} disabled={disabled || isSubmitting} hitSlop={8} style={styles.row}>
      {isSubmitting ? (
        <ActivityIndicator size="small" color={liked ? c.accentInk : c.textSecondary} />
      ) : (
        <Heart
          color={liked ? c.accentInk : c.textSecondary}
          fill={liked ? c.accentInk : 'transparent'}
          size={size}
        />
      )}
      <View style={styles.countWrap}>
        <Text style={[styles.count, { color: liked ? c.accentInk : c.textSecondary }]}>{count}</Text>
      </View>
    </PressableScale>
  );
}

export const LikeButton = memo(LikeButtonComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  countWrap: {
    minWidth: 12,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
  },
});