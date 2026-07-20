// client-mobile/components/YearReviewCard.tsx
// Single large hero card for one Year-in-Review stat.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useAppTheme } from '../lib/theme';

interface YearReviewCardProps {
  label: string;
  value: string;
  sublabel?: string;
  Icon: LucideIcon;
  accentColor?: string;
}

export default function YearReviewCard({
  label,
  value,
  sublabel,
  Icon,
  accentColor,
}: YearReviewCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  // `accentColor` lets the year-review screen vary hue per card (coral/blue/
  // purple, pre-existing non-token accents kept for visual variety across a
  // carousel of stats — not a new color introduced by this migration).
  // Falls back to the theme's own accent when the caller doesn't override it.
  const resolvedAccent = accentColor ?? c.accentInk;

  return (
    <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <View style={[styles.iconWrap, { backgroundColor: `${resolvedAccent}1A` }]}>
        <Icon color={resolvedAccent} size={28} strokeWidth={1.5} />
      </View>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: resolvedAccent }]} numberOfLines={2}>
        {value}
      </Text>
      {sublabel ? <Text style={[styles.sublabel, { color: c.textTertiary }]}>{sublabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 4,
    width: 280,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  sublabel: {
    fontSize: 12,
    textAlign: 'center',
  },
});
