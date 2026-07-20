// client-mobile/components/Snackbar.tsx
// Bottom-anchored toast with an optional action button (e.g. "UNDO") and
// an auto-dismiss timer. Used first by the Catch-Up cascade's undo
// affordance (marking many prior episodes watched in one confirm is the
// hardest action in the app to reverse by hand) — kept generic so any
// future bulk/hard-to-reverse action can reuse it instead of a one-off.

import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

export interface SnackbarProps {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** How far above the screen bottom the bar sits — override to clear a
   *  floating tab bar (e.g. 100 on the Shows Hub) vs. a plain stack screen
   *  with no bottom chrome (default 24). */
  bottomOffset?: number;
  durationMs?: number;
}

export default function Snackbar({
  visible,
  message,
  actionLabel,
  onAction,
  onDismiss,
  bottomOffset = 24,
  durationMs = 5000,
}: SnackbarProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const translateY = useSharedValue(80);

  useEffect(() => {
    if (!visible) return;
    translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
    // onDismiss is a useCallback from the caller; re-running the timer only
    // on visible/durationMs change (not every onDismiss identity change) is
    // the correct behavior for an auto-dismiss timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, durationMs]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: bottomOffset }, animStyle]}
    >
      <Animated.View
        style={[styles.bar, { backgroundColor: c.bgElevated, borderColor: c.hairline }]}
      >
        <Text style={[styles.message, { color: c.textPrimary }]} numberOfLines={2}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <PressableScale onPress={onAction} hitSlop={10}>
            <Text style={[styles.action, { color: c.accentInk }]}>{actionLabel}</Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  message: { flex: 1, fontSize: 13, fontWeight: '600' },
  action: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
});
