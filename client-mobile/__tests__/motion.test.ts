import { AccessibilityInfo } from 'react-native';

import { isReduceMotionEnabled } from '../lib/motion';

describe('reduce-motion singleton (C3)', () => {
  it('reads AccessibilityInfo and registers its listener exactly once at module load, no matter how many call sites read it afterward', () => {
    // lib/motion.ts's module-level side effect already ran once, at the
    // static import above — before PressableScale's 218 call sites, or this
    // test's own loop below, ever touch isReduceMotionEnabled().
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
      'reduceMotionChanged',
      expect.any(Function)
    );

    // Simulate 50 PressableScale mounts, each reading the singleton inside
    // its onPressIn/onPressOut handlers.
    for (let i = 0; i < 50; i++) {
      isReduceMotionEnabled();
    }

    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('returns a boolean synchronously, without awaiting anything', () => {
    expect(typeof isReduceMotionEnabled()).toBe('boolean');
  });
});
