// client-mobile/components/MilestoneCard.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ProgressRing } from './ProgressRing';
import { useAppTheme } from '../lib/theme';

interface MilestoneCardProps {
  label: string;
  description: string;
  progress: number;       // 0.0 – 1.0
  progressLabel: string;
  earned: boolean;
}

export default function MilestoneCard({
  label,
  description,
  progress,
  progressLabel,
  earned,
}: MilestoneCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.glassFill, borderColor: earned ? c.accentDim : c.hairline },
      ]}
    >
      <ProgressRing
        percentage={Math.min(progress * 100, 100)}
        size={52}
        strokeWidth={4}
        showLabel={false}
        color={c.accentInk}
        trackColor={c.trackRing}
      />
      <View style={styles.textBlock}>
        <Text style={[styles.label, { color: c.textPrimary }]}>{label}</Text>
        <Text style={[styles.desc, { color: c.textTertiary }]} numberOfLines={1}>
          {description}
        </Text>
        <Text style={[styles.progressLabel, { color: earned ? c.accentInk : c.textSecondary }]}>
          {earned ? '✓ Unlocked' : progressLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 14,
    alignItems: 'center',
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
  desc: {
    fontSize: 11,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
});
