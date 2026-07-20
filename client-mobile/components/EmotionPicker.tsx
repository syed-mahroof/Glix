// client-mobile/components/EmotionPicker.tsx
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';
import { Emotion } from '../store/watchStore';

interface EmotionOption {
  value: Emotion;
  emoji: string;
  label: string;
}

// Mirrors core/models.py EpisodeInteraction.Emotion choices exactly.
const EMOTIONS: EmotionOption[] = [
  { value: 'HAPPY', emoji: '😄', label: 'Happy' },
  { value: 'SHOCKED', emoji: '😱', label: 'Shocked' },
  { value: 'SAD', emoji: '😢', label: 'Sad' },
  { value: 'GOOD', emoji: '👍', label: 'Good' },
  { value: 'FUN', emoji: '🎉', label: 'Fun' },
];

export interface EmotionPickerProps {
  value: Emotion | null;
  onSelect: (emotion: Emotion) => void;
  disabled?: boolean;
}

function EmotionPickerComponent({ value, onSelect, disabled = false }: EmotionPickerProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={styles.row}>
      {EMOTIONS.map((option) => {
        const isSelected = value === option.value;
        return (
          <PressableScale
            key={option.value}
            onPress={() => onSelect(option.value)}
            disabled={disabled}
            style={[
              styles.chip,
              { backgroundColor: c.glassFill, borderColor: c.hairline },
              isSelected && { backgroundColor: c.accentDim, borderColor: c.accentInk },
              disabled && styles.chipDisabled,
            ]}
          >
            <Text style={styles.emoji}>{option.emoji}</Text>
            <Text style={[styles.label, { color: c.textSecondary }, isSelected && { color: c.accentInk }]}>
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export const EmotionPicker = memo(EmotionPickerComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  emoji: {
    fontSize: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});