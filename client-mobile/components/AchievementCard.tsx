// client-mobile/components/AchievementCard.tsx
import { Award } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AchievementItem } from '../store/watchStore';
import { BADGE_ICON_MAP } from '../lib/badges';
import { useAppTheme } from '../lib/theme';

interface AchievementCardProps {
  item: AchievementItem;
}

export default function AchievementCard({ item }: AchievementCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const IconComponent = BADGE_ICON_MAP[item.icon] ?? Award;
  const earned = item.earned;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.glassFill, borderColor: earned ? c.accentDim : c.hairline },
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: earned ? c.accentDim : c.trackRing },
        ]}
      >
        <IconComponent
          color={earned ? c.accentInk : c.textTertiary}
          size={22}
          strokeWidth={1.75}
        />
      </View>

      <View style={styles.body}>
        <Text style={[styles.label, { color: earned ? c.textPrimary : c.textTertiary }]} numberOfLines={1}>
          {earned ? item.label : '???'}
        </Text>
        <Text style={[styles.desc, { color: c.textSecondary }]} numberOfLines={2}>
          {earned ? item.description : item.progress_label}
        </Text>

        {/* Progress bar */}
        <View style={[styles.progressTrack, { backgroundColor: c.trackRing }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.min(item.progress * 100, 100)}%`,
                backgroundColor: c.accentFill,
                opacity: earned ? 1 : 0.45,
              },
            ]}
          />
        </View>
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
    gap: 12,
    alignItems: 'center',
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  desc: {
    fontSize: 11,
    lineHeight: 15,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
  },
});
