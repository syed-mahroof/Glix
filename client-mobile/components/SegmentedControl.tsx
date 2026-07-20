import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

export interface Segment {
  value: string;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  segments: { value: T; label: string }[];
  selectedValue: T;
  onValueChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  segments,
  selectedValue,
  onValueChange,
}: SegmentedControlProps<T>) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View style={[styles.segmentedControl, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      {segments.map((segment) => {
        const isActive = selectedValue === segment.value;
        return (
          <PressableScale
            key={segment.value}
            style={[styles.segment, isActive && { backgroundColor: c.accentFill }]}
            onPress={() => onValueChange(segment.value)}
          >
            <Text style={[styles.segmentText, { color: isActive ? c.onAccent : c.textSecondary }]}>
              {segment.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
