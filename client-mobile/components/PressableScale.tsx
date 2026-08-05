// client-mobile/components/PressableScale.tsx
// Reusable tactile-feedback wrapper (Phase 12 polish), adopted across
// profile.tsx and other screens for every interactive row/button/card.
// Spring to ~0.96 on press-in, back on release — Reanimated's withSpring
// keeps it on the UI thread (no bridge jank), and no-ops the animation
// under prefers-reduced-motion so it never fights an accessibility setting.
//
// Phase 83 perf: reduce-motion used to be read per-instance (its own async
// AccessibilityInfo call + listener, on mount, at each of this component's
// 218 call sites across 71 files — re-run on every FlashList recycle-
// remount). Now reads lib/motion.ts's module-level singleton synchronously
// inside the handler — onPressIn/onPressOut are plain JS-thread callbacks,
// so no shared value or hook is needed to see today's answer.

import React from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { isReduceMotionEnabled } from '../lib/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends PressableProps {
  children: React.ReactNode;
  /** How far to scale down on press-in. Default 0.96. */
  scaleTo?: number;
}

function PressableScale({
  children,
  scaleTo = 0.96,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[animatedStyle, style as any]}
      onPressIn={(e) => {
        if (!isReduceMotionEnabled()) {
          scale.value = withSpring(scaleTo, { damping: 16, stiffness: 400 });
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!isReduceMotionEnabled()) {
          scale.value = withSpring(1, { damping: 14, stiffness: 300 });
        }
        onPressOut?.(e);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}

export default React.memo(PressableScale);
