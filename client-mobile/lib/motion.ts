// client-mobile/lib/motion.ts
// Entrance-rhythm helper (Phase 12 polish, part 1.02): a 60ms stagger with
// a ~300ms rise so cards arrive in sequence instead of all rendering at
// once. Gate application behind `usePrefersReducedMotion()` so a reduced-
// motion user gets an instant render instead of a forced animation.
//
// Phase 83 perf: reduce-motion used to be read per-component (this file's
// own hook, plus an identical copy inlined in PressableScale.tsx) — 218
// PressableScale call sites across 71 files meant 218 concurrent
// AccessibilityInfo.isReduceMotionEnabled() native calls and 218
// 'reduceMotionChanged' listener subscriptions, re-registered on every
// FlashList recycle-remount. Replaced with one module-level singleton: one
// native read, one listener, app-wide.

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { FadeInUp } from 'react-native-reanimated';

let reduceMotionEnabled = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
  reduceMotionEnabled = enabled;
  notify();
});
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
  reduceMotionEnabled = enabled;
  notify();
});

/** Synchronous read of the current value — for plain JS-thread callbacks
 *  (e.g. PressableScale's onPressIn/onPressOut) that don't need a
 *  subscription, just today's answer. */
export function isReduceMotionEnabled(): boolean {
  return reduceMotionEnabled;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function getSnapshot(): boolean {
  return reduceMotionEnabled;
}

/** Re-renders the caller when the OS setting changes — for the handful of
 *  real consumers (achievements.tsx, analytics.tsx, year-review.tsx) that
 *  actually branch their render output on this, unlike PressableScale which
 *  only needs isReduceMotionEnabled() inside an event handler. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** `entering` prop for the Nth item in a staggered list. */
export function staggerEntering(index: number, stepMs = 60, durationMs = 300) {
  return FadeInUp.delay(index * stepMs).duration(durationMs);
}
