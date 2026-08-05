// client-mobile/components/GlassBlur.tsx
// Drop-in Android replacement for expo-blur's <BlurView>.
//
// Verified from the Kotlin, not guessed: with the default
// experimentalBlurMethod="none", ExpoBlurView.kt routes straight to
// setBackgroundColor(tint.toColorInt(intensity)) — no blur happens on
// Android at all, just a solid translucent color. Every glass surface in
// this app already layers a theme tint (c.glassFill) directly on top of the
// BlurView anyway (see LiquidTabBar/discover.tsx), so the blur layer
// underneath was purely a flat color no one could tell apart from a plain
// View — at the cost of 3 nested native views per instance, plus
// onAttachedToWindow allocating a RenderEffectBlur and installing a
// controller on the nearest Screen ancestor before setBlurMethod(NONE)
// immediately disables it.
//
// This replicates that exact solid color directly (one View, Android only)
// instead of paying for the machinery that produces it. iOS is untouched —
// there BlurView really is a live UIVisualEffectView, which is what's
// actually on screen; lowering intensity there wouldn't even reduce cost
// (it only sets fractionComplete on a paused animator), so there's nothing
// to optimize on that platform.
//
// Formula, copied from TintStyle.kt's private toColorInt(): for tint DARK,
// alpha = trunc(255 * intensity/100 * 0.69) over rgb(25,25,25); for tint
// LIGHT, alpha = trunc(255 * intensity/100 * 0.78) over rgb(249,249,249).
// Kotlin's `.toInt()` on a Double truncates toward zero, not rounds — this
// mirrors that with Math.trunc so the byte-for-byte alpha matches what the
// native view would have painted. Known call sites, for reference (also
// independently re-derived by __tests__/glassBlur.test.ts so a typo here
// can't silently pass):
//   intensity=100, dark: rgba(25,25,25,0.686)   light: rgba(249,249,249,0.776)
//   intensity=80,  dark: rgba(25,25,25,0.549)   light: rgba(249,249,249,0.624)
//   intensity=70,  dark: rgba(25,25,25,0.482)   light: rgba(249,249,249,0.545)

import { BlurView, BlurViewProps } from 'expo-blur';
import React from 'react';
import { Platform, View } from 'react-native';

const DARK_RGB = 25;
const DARK_FACTOR = 0.69;
const LIGHT_RGB = 249;
const LIGHT_FACTOR = 0.78;

export function androidGlassColor(tint: 'dark' | 'light', intensity: number): string {
  const rgb = tint === 'dark' ? DARK_RGB : LIGHT_RGB;
  const factor = tint === 'dark' ? DARK_FACTOR : LIGHT_FACTOR;
  const alpha255 = Math.trunc(255 * (intensity / 100) * factor);
  return `rgba(${rgb},${rgb},${rgb},${alpha255 / 255})`;
}

interface GlassBlurProps extends Omit<BlurViewProps, 'tint'> {
  tint: 'dark' | 'light';
}

export default function GlassBlur({ intensity = 50, tint, style }: GlassBlurProps) {
  if (Platform.OS === 'android') {
    return <View style={[style, { backgroundColor: androidGlassColor(tint, intensity) }]} />;
  }
  return <BlurView intensity={intensity} tint={tint} style={style} />;
}
