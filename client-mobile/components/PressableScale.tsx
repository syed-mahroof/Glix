// client-mobile/components/PressableScale.tsx
// Reusable tactile-feedback wrapper (Phase 12 polish), adopted across
// profile.tsx and other screens for every interactive row/button/card.
// Spring to ~0.96 on press-in, back on release — Reanimated's withSpring
// keeps it on the UI thread (no bridge jank), and no-ops the animation
// under prefers-reduced-motion so it never fights an accessibility setting.

import React from 'react';
import { AccessibilityInfo, Pressable, type PressableProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends PressableProps {
  children: React.ReactNode;
  /** How far to scale down on press-in. Default 0.96. */
  scaleTo?: number;
}

export default function PressableScale({
  children,
  scaleTo = 0.96,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const reduceMotionRef = React.useRef(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reduceMotionRef.current = enabled;
    });
    return () => sub.remove();
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[animatedStyle, style as any]}
      onPressIn={(e) => {
        if (!reduceMotionRef.current) {
          scale.value = withSpring(scaleTo, { damping: 16, stiffness: 400 });
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduceMotionRef.current) {
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
