// client-mobile/lib/typography.ts
// Precision layer (Phase 12 polish, part 1.01): gives data its own typeface
// so labels/legends/captions read as instrumented instead of sharing the
// body font with prose.
//
// Deviation from the design brief, stated explicitly: the brief calls for
// JetBrains Mono via expo-font. Neither expo-font nor a font asset exists
// in this repo, and AI_RULES.md locks the dependency list — adding a new
// package + binary font asset wasn't verified safe to pull in this pass.
// `monospace` is a cross-platform generic RN already resolves natively
// (Android: Droid Sans Mono; iOS: Courier). It gets the same visual
// job — a dashboard reading as instrumented — done with zero new
// dependencies. Swap `MONO_FONT_FAMILY` for a real JetBrains Mono family
// name later if `@expo-google-fonts/jetbrains-mono` is added; every caller
// of `monoLabelStyle` picks it up automatically.

import { Platform, type TextStyle } from 'react-native';

export const MONO_FONT_FAMILY = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  default: 'monospace',
});

/** Uppercase, tracked-out, monospace — for captions/legends/data labels. */
export const monoLabelStyle: TextStyle = {
  fontFamily: MONO_FONT_FAMILY,
  textTransform: 'uppercase',
  letterSpacing: 1,
};

/** Monospace with tabular figures, no caption transforms — for the large
 *  numeric values themselves (stat counters, counts), as distinct from
 *  monoLabelStyle's caption treatment. Digits line up at a fixed width
 *  instead of each having its own natural (proportional) advance width. */
export const monoValueStyle: TextStyle = {
  fontFamily: MONO_FONT_FAMILY,
  fontVariant: ['tabular-nums'],
};
