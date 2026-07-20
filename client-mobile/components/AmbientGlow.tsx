// client-mobile/components/AmbientGlow.tsx
// A quiet radial glow behind a hero metric (Phase 12 polish) — the portable
// equivalent of Aura's WebGL atmosphere: gives the number depth instead of
// sitting flat, at near-zero GPU cost (one static SVG radial gradient).
// Stays secondary to the number it sits behind — low opacity, centered,
// non-interactive — same guardrail Aura's own board asks for.

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useAppTheme } from '../lib/theme';

interface AmbientGlowProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export default function AmbientGlow({ size = 240, style }: AmbientGlowProps) {
  const { theme } = useAppTheme();
  const centerOpacity = theme.name === 'dark' ? 0.16 : 0.12;

  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: size,
          height: size,
          marginTop: -size / 2,
          marginLeft: -size / 2,
        },
        style,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="ambientGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={theme.colors.accentInk} stopOpacity={centerOpacity} />
            <Stop offset="100%" stopColor={theme.colors.accentInk} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#ambientGlow)" />
      </Svg>
    </View>
  );
}
