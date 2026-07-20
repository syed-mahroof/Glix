// client-mobile/components/LayoutToggle.tsx
// Global list/grid layout switch shared by every primary media list (Shows
// Hub, Movies Hub, Profile > My Shows/My Movies). Mirrors the icon-only,
// compact two-button toggle pattern already established by the Shows Hub's
// Upcoming List/Calendar switch — same shape, new icons, backed by
// `watchStore.preferredLayout` instead of local screen state so the choice
// is shared and persisted app-wide.

import { LayoutGrid, List as ListIcon } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import { useWatchStore } from '../store/watchStore';
import PressableScale from './PressableScale';

export default function LayoutToggle() {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const preferredLayout = useWatchStore((s) => s.preferredLayout);
  const toggleLayout = useWatchStore((s) => s.toggleLayout);

  return (
    <View style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <PressableScale
        onPress={() => preferredLayout !== 'list' && toggleLayout()}
        style={[styles.btn, preferredLayout === 'list' && { backgroundColor: c.accentFill }]}
        accessibilityRole="button"
        accessibilityLabel="List view"
        accessibilityState={{ selected: preferredLayout === 'list' }}
      >
        <ListIcon
          color={preferredLayout === 'list' ? c.onAccent : c.textSecondary}
          size={16}
          strokeWidth={2.25}
        />
      </PressableScale>
      <PressableScale
        onPress={() => preferredLayout !== 'grid' && toggleLayout()}
        style={[styles.btn, preferredLayout === 'grid' && { backgroundColor: c.accentFill }]}
        accessibilityRole="button"
        accessibilityLabel="Grid view"
        accessibilityState={{ selected: preferredLayout === 'grid' }}
      >
        <LayoutGrid
          color={preferredLayout === 'grid' ? c.onAccent : c.textSecondary}
          size={16}
          strokeWidth={2.25}
        />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 3,
  },
  btn: {
    width: 32,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
