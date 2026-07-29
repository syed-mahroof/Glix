// client-mobile/components/ErrorState.tsx
// Shared retry-card for screens whose data comes from a single fetch that
// can fail (cold start, timeout, offline). Extracted from the identical
// inline block already duplicated across show/[id].tsx, movie/[id].tsx,
// episode/[id].tsx, and discover.tsx once a 5th+6th+7th+8th copy would have
// been needed for the analytics screens (analytics.tsx, achievements.tsx,
// statistics.tsx, year-review.tsx) — those four previously swallowed fetch
// errors silently and rendered an empty-state that looked identical to
// "you genuinely have zero data", which is exactly what made a real fetch
// failure on the Achievements screen look like lost/missing badges.
import { WifiOff } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import GlassSurface from './GlassSurface';
import PressableScale from './PressableScale';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View style={styles.centered}>
      <GlassSurface radius={18} style={styles.errorCard}>
        <WifiOff color={c.textTertiary} size={32} strokeWidth={1.5} />
        <Text style={[styles.errorText, { color: c.textSecondary }]}>{message}</Text>
        <PressableScale style={[styles.retryButton, { backgroundColor: c.accentFill }]} onPress={onRetry}>
          <Text style={[styles.retryButtonText, { color: c.onAccent }]}>Retry</Text>
        </PressableScale>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  errorCard: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 28,
    paddingVertical: 32,
    width: '100%',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
