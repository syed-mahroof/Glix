// client-mobile/components/ProgressRing.tsx
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useAppTheme } from '../lib/theme';

export interface ProgressRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  showLabel?: boolean;
  labelFontSize?: number;
}

function ProgressRingComponent({
  percentage,
  size = 44,
  strokeWidth = 4,
  color,
  trackColor,
  showLabel = true,
  labelFontSize = 9,
}: ProgressRingProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const strokeColor = color ?? c.accentInk;
  const ringTrackColor = trackColor ?? c.trackRing;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const strokeDashoffset = circumference - (circumference * clamped) / 100;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringTrackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      {showLabel && (
        <Text style={[styles.label, { fontSize: labelFontSize, color: strokeColor }]}>
          {Math.round(clamped)}%
        </Text>
      )}
    </View>
  );
}

export const ProgressRing = memo(ProgressRingComponent);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    fontWeight: '700',
  },
});