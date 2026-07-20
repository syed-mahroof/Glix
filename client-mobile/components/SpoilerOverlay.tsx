// client-mobile/components/SpoilerOverlay.tsx
import { Eye } from 'lucide-react-native';
import React, { memo, ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

export interface SpoilerOverlayProps {
  isSpoiler: boolean;
  children: ReactNode;
  label?: string;
}

function SpoilerOverlayComponent({
  isSpoiler,
  children,
  label = 'Spoiler — tap to reveal',
}: SpoilerOverlayProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [isRevealed, setIsRevealed] = useState(false);

  if (!isSpoiler || isRevealed) {
    return <View>{children}</View>;
  }

  return (
    <Pressable onPress={() => setIsRevealed(true)} style={styles.wrap}>
      <View style={styles.hiddenContent} pointerEvents="none">
        {children}
      </View>
      <View style={[styles.blurLayer, { backgroundColor: c.glassFill, borderColor: c.hairline }]} />
      <View style={styles.labelRow}>
        <Eye color={c.textSecondary} size={13} />
        <Text style={[styles.labelText, { color: c.textSecondary }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

export const SpoilerOverlay = memo(SpoilerOverlayComponent);

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  hiddenContent: {
    opacity: 0.15,
  },
  blurLayer: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  labelRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  labelText: {
    fontSize: 12,
    fontWeight: '600',
    fontStyle: 'italic',
  },
});