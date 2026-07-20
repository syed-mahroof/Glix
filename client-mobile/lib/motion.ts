// client-mobile/lib/motion.ts
// Entrance-rhythm helper (Phase 12 polish, part 1.02): a 60ms stagger with
// a ~300ms rise so cards arrive in sequence instead of all rendering at
// once. Gate application behind `usePrefersReducedMotion()` so a reduced-
// motion user gets an instant render instead of a forced animation.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { FadeInUp } from 'react-native-reanimated';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** `entering` prop for the Nth item in a staggered list. */
export function staggerEntering(index: number, stepMs = 60, durationMs = 300) {
  return FadeInUp.delay(index * stepMs).duration(durationMs);
}
