// client-mobile/components/TimeWatchedCard.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

interface TimeWatchedCardProps {
  days: number;
  hours: number;
  minutes: number;
}

function AnimatedCounter({ target, duration = 1200, color }: { target: number; duration?: number; color: string }) {
  const animated = useRef(new Animated.Value(0)).current;
  const displayRef = useRef(0);

  useEffect(() => {
    Animated.timing(animated, {
      toValue: target,
      duration,
      useNativeDriver: false,
    }).start();
  }, [target]);

  const [display, setDisplay] = React.useState(0);

  useEffect(() => {
    const id = animated.addListener(({ value }) => {
      const rounded = Math.round(value);
      if (rounded !== displayRef.current) {
        displayRef.current = rounded;
        setDisplay(rounded);
      }
    });
    return () => animated.removeListener(id);
  }, []);

  return <Text style={[styles.statValue, { color }]}>{display}</Text>;
}

export default function TimeWatchedCard({ days, hours, minutes }: TimeWatchedCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <View style={styles.statItem}>
        <AnimatedCounter target={days} color={c.accentInk} />
        <Text style={[styles.statLabel, { color: c.textSecondary }]}>Days</Text>
      </View>
      <View style={[styles.divider, { backgroundColor: c.hairline }]} />
      <View style={styles.statItem}>
        <AnimatedCounter target={hours} color={c.accentInk} />
        <Text style={[styles.statLabel, { color: c.textSecondary }]}>Hours</Text>
      </View>
      <View style={[styles.divider, { backgroundColor: c.hairline }]} />
      <View style={styles.statItem}>
        <AnimatedCounter target={minutes} color={c.accentInk} />
        <Text style={[styles.statLabel, { color: c.textSecondary }]}>Minutes</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingVertical: 20,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
  },
});
