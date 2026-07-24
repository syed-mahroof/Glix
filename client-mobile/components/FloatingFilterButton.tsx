// client-mobile/components/FloatingFilterButton.tsx
// Floating "FILTERS" trigger for My Shows / My Movies (Phase 57), replacing
// the old inline pill row. Shadow/elevation values match `Snackbar.tsx`'s
// existing floating-element precedent, not new invented values.

import { SlidersHorizontal } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

interface Props {
  onPress: () => void;
  active: boolean;
}

export default function FloatingFilterButton({ onPress, active }: Props) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <PressableScale
        style={[
          styles.btn,
          { backgroundColor: c.glassFill, borderColor: c.hairline },
          active && { backgroundColor: c.accentDim, borderColor: c.accentInk },
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Filters"
      >
        <SlidersHorizontal color={active ? c.accentInk : c.textSecondary} size={16} strokeWidth={2.25} />
        <Text style={[styles.label, { color: active ? c.accentInk : c.textSecondary }]}>FILTERS</Text>
        {active && <View style={[styles.dot, { backgroundColor: c.accentFill }]} />}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    bottom: 20,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
