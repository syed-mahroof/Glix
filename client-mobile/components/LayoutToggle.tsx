// client-mobile/components/LayoutToggle.tsx
// List/grid layout switch shared by every primary media list (Shows Hub,
// Movies Hub, Profile > My Shows/My Movies/My Anime). Mirrors the icon-only,
// compact two-button toggle pattern already established by the Shows Hub's
// Upcoming List/Calendar switch — same shape, new icons. Each screen passes
// its own `scope`, so switching layout on one screen never affects another;
// all of them fall back to the Settings > Appearance default until a screen
// gets its own override (see preferencesStore's useLayoutFor).

import { LayoutGrid, List as ListIcon } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import { LayoutScope, useLayoutFor, usePreferencesStore } from '../store/preferencesStore';
import PressableScale from './PressableScale';

export default function LayoutToggle({ scope }: { scope: LayoutScope }) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const layout = useLayoutFor(scope);
  const setLayoutForScope = usePreferencesStore((s) => s.setLayoutForScope);

  return (
    <View style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <PressableScale
        onPress={() => layout !== 'list' && setLayoutForScope(scope, 'list')}
        style={[styles.btn, layout === 'list' && { backgroundColor: c.accentFill }]}
        accessibilityRole="button"
        accessibilityLabel="List view"
        accessibilityState={{ selected: layout === 'list' }}
      >
        <ListIcon
          color={layout === 'list' ? c.onAccent : c.textSecondary}
          size={16}
          strokeWidth={2.25}
        />
      </PressableScale>
      <PressableScale
        onPress={() => layout !== 'grid' && setLayoutForScope(scope, 'grid')}
        style={[styles.btn, layout === 'grid' && { backgroundColor: c.accentFill }]}
        accessibilityRole="button"
        accessibilityLabel="Grid view"
        accessibilityState={{ selected: layout === 'grid' }}
      >
        <LayoutGrid
          color={layout === 'grid' ? c.onAccent : c.textSecondary}
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
