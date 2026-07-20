// client-mobile/components/GlassSurface.tsx
// Codified "real glass" recipe (Phase 12 polish) so every card/row/sheet
// inherits the same material instead of a flat single-fill rectangle with
// an invisible-on-black drop shadow. Theme-aware: dark gets depth from a
// vertical fill gradient + a brighter top edge (shadows are invisible on
// pure black); light gets a soft, visible drop shadow instead.
//
// Hue is untouched in both themes — this only adds value/depth, never a
// new color. Radius/border rules stay exactly what AI_RULES.md §2 locks.

import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { elevation, useAppTheme } from '../lib/theme';

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius — stays within the locked 14–20px card range. */
  radius?: number;
  /** Elevation level for the light theme's shadow (dark ignores this). */
  level?: 1 | 2;
}

export default function GlassSurface({ children, style, radius = 16, level = 1 }: GlassSurfaceProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  // IMPORTANT: `children` render as direct flow siblings here, not inside a
  // nested wrapper View. A nested `<View style={{flex:1}}>{children}</View>`
  // would default to flexDirection:'column' regardless of what layout the
  // caller passes via `style` (e.g. `flexDirection:'row'` for a row of
  // stats or a row+chevron) — RN layout props don't cascade through a
  // wrapper, so that row intent would silently apply only to the outer
  // View (which has one flowing child) while the real children stack in a
  // column. The gradient/edge-light are `position:absolute` and so stay
  // out of flow, leaving `children` as the only in-flow content and free
  // to use whatever flexDirection `style` specifies.
  return (
    <View
      style={[
        styles.outer,
        { borderRadius: radius, borderColor: c.hairline },
        elevation(theme, level),
        style,
      ]}
    >
      <LinearGradient
        colors={[c.glassGradTop, c.glassGradBot]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* 1px inner highlight along the top edge — the "catches light" cue */}
      <View style={[styles.edgeLight, { backgroundColor: c.edgeLight }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  edgeLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
});
