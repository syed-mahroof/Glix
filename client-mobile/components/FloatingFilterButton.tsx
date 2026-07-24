// client-mobile/components/FloatingFilterButton.tsx
// Floating "FILTERS" trigger for My Shows / My Movies. Bottom-centered,
// safe-area aware, always solid accentFill (Phase 63 rework — was
// previously right-pinned with a color that only activated when a filter
// was applied; now a permanent CTA-style floating action button matching
// the app's #E4FA1A accent, with a small dot overlay as the "filters
// applied" indicator instead of a full color swap). Shadow/elevation
// values match `Snackbar.tsx`'s existing floating-element precedent, not
// new invented values.

import { SlidersHorizontal } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

interface Props {
  onPress: () => void;
  active: boolean;
}

export default function FloatingFilterButton({ onPress, active }: Props) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
      <PressableScale
        style={[styles.btn, { backgroundColor: c.accentFill }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Filters"
        accessibilityState={{ selected: active }}
      >
        <SlidersHorizontal color={c.onAccent} size={16} strokeWidth={2.25} />
        <Text style={[styles.label, { color: c.onAccent }]}>FILTERS</Text>
        {active && <View style={[styles.dot, { backgroundColor: c.onAccent }]} />}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
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
