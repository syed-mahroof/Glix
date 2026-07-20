// client-mobile/components/StatsCard.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useAppTheme } from '../lib/theme';
import { monoLabelStyle } from '../lib/typography';

interface StatsCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  Icon?: LucideIcon;
  accent?: boolean;
  style?: object;
}

export default function StatsCard({
  label,
  value,
  sublabel,
  Icon,
  accent = false,
  style,
}: StatsCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }, style]}>
      {Icon && (
        <View style={[styles.iconWrap, { backgroundColor: accent ? c.accentDim : c.accentDim }]}>
          <Icon color={c.accentInk} size={18} strokeWidth={1.75} />
        </View>
      )}
      <Text style={[styles.value, { color: c.accentInk }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.label, monoLabelStyle, { color: c.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      {sublabel ? <Text style={[styles.sublabel, { color: c.textTertiary }]}>{sublabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 4,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  sublabel: {
    fontSize: 10,
    textAlign: 'center',
  },
});
