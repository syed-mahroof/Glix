// client-mobile/lib/theme.ts
//
// The single source of truth for Glix's adaptive light/dark design
// system (Phase 9). Every screen previously hard-coded its colors as module
// constants (`const NEON_YELLOW = '#E4FA1A'`); those migrate to `useAppTheme()`
// reads against the tokens defined here.
//
// KEY DESIGN DECISION — the accent splits into two roles:
//   • accentFill : ALWAYS bright #E4FA1A, in BOTH themes, because it is only
//                  ever used as a FILL paired with dark `onAccent` text (the
//                  active tab pill, solid buttons). Legible on either ground.
//   • accentInk  : the accent used as a FOREGROUND (progress rings, active
//                  labels, checkmarks, outline buttons). Bright yellow on dark,
//                  a darkened lime (#434F08, ~7:1 on the light ground) on light —
//                  because #E4FA1A as text on white is effectively invisible.
//
// Depth technique also flips per theme: dark relies on a top edge-light + fill
// gradient (drop shadows are invisible on #000); light relies on a soft drop
// shadow (which IS visible on a light ground) — see `elevation()`.

import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useColorScheme, type ViewStyle } from 'react-native';
import {
  DarkTheme as NavDarkTheme,
  DefaultTheme as NavLightTheme,
  type Theme as NavigationTheme,
} from '@react-navigation/native';

import { useThemeStore, type ThemePreference } from '../store/themeStore';

export type ThemeName = 'light' | 'dark';

export interface ThemeColors {
  /** Screen root background. */
  bg: string;
  /** Slightly raised background for nested/elevated surfaces. */
  bgElevated: string;
  /** Solid-ish glass card fill (used directly, or under a BlurView). */
  glassFill: string;
  /** Two-stop gradient for the premium glass recipe. */
  glassGradTop: string;
  glassGradBot: string;
  /** Hairline divider/border. */
  hairline: string;
  /** Brighter top edge that catches light on a glass card. */
  edgeLight: string;

  /** Bright accent used ONLY as a fill behind `onAccent` text. Both themes. */
  accentFill: string;
  /** Accent used as a foreground (text/icon/stroke). Theme-dependent value. */
  accentInk: string;
  /** Translucent accent wash for chip/pill backgrounds. */
  accentDim: string;
  /** Text/icon color that sits ON top of `accentFill`. */
  onAccent: string;
  /**
   * Translucent `onAccent`, for a ProgressRing track drawn ON an
   * `accentFill` button. Not a new hue — the same ink as `onAccent`, at
   * low alpha. `trackRing` is unusable there: it is a light wash meant
   * for dark grounds and vanishes against bright yellow.
   */
  onAccentTrack: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  negative: string;
  negativeDim: string;

  /** Track color behind a ProgressRing / conic gauge. */
  trackRing: string;
  /** Inactive tab / control tint. */
  tabInactive: string;

  /** Faint ambient glow tint behind hero metrics/backdrops. */
  ambient: string;
}

export interface AppTheme {
  name: ThemeName;
  colors: ThemeColors;
  /** Tint to pass to expo-blur's BlurView. */
  blurTint: 'dark' | 'light';
  /** Style prop for expo-status-bar. */
  statusBar: 'light' | 'dark';
}

const darkColors: ThemeColors = {
  bg: '#000000',
  bgElevated: '#0A0A0A',
  glassFill: 'rgba(30, 30, 30, 0.65)',
  glassGradTop: 'rgba(52, 52, 52, 0.72)',
  glassGradBot: 'rgba(22, 22, 22, 0.66)',
  hairline: 'rgba(255, 255, 255, 0.12)',
  edgeLight: 'rgba(255, 255, 255, 0.22)',

  accentFill: '#E4FA1A',
  accentInk: '#E4FA1A',
  accentDim: 'rgba(228, 250, 26, 0.14)',
  onAccent: '#000000',
  onAccentTrack: 'rgba(0, 0, 0, 0.22)',

  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.60)',
  textTertiary: 'rgba(255, 255, 255, 0.40)',

  negative: '#FF453A',
  negativeDim: 'rgba(255, 69, 58, 0.14)',

  trackRing: 'rgba(255, 255, 255, 0.08)',
  tabInactive: '#6B6B6E',

  ambient: 'rgba(228, 250, 26, 0.06)',
};

const lightColors: ThemeColors = {
  // Cool-neutral "paper" ground, biased faintly toward the accent so it reads
  // chosen rather than default. Raised pure-white cards on top = premium layering.
  bg: '#EDEEEA',
  bgElevated: '#FBFBF8',
  glassFill: 'rgba(251, 251, 248, 0.88)',
  glassGradTop: 'rgba(255, 255, 255, 0.94)',
  glassGradBot: 'rgba(248, 248, 244, 0.86)',
  hairline: 'rgba(17, 19, 8, 0.10)',
  edgeLight: 'rgba(255, 255, 255, 0.95)',

  accentFill: '#E4FA1A', // stays bright — always paired with dark onAccent text
  accentInk: '#434F08', // darkened lime, ~7:1 on the paper ground
  accentDim: 'rgba(150, 175, 0, 0.16)',
  onAccent: '#14170A',
  onAccentTrack: 'rgba(20, 23, 10, 0.22)',

  textPrimary: '#111308', // inky near-black (warm/olive bias) preserves OLED "richness"
  textSecondary: 'rgba(17, 19, 8, 0.58)',
  textTertiary: 'rgba(17, 19, 8, 0.40)',

  negative: '#D63A2E', // slightly deepened for legibility on light
  negativeDim: 'rgba(214, 58, 46, 0.12)',

  trackRing: 'rgba(17, 19, 8, 0.08)',
  tabInactive: '#8A8B82',

  ambient: 'rgba(150, 175, 0, 0.07)',
};

export const darkTheme: AppTheme = {
  name: 'dark',
  colors: darkColors,
  blurTint: 'dark',
  statusBar: 'light',
};

export const lightTheme: AppTheme = {
  name: 'light',
  colors: lightColors,
  blurTint: 'light',
  statusBar: 'dark',
};

export const themes: Record<ThemeName, AppTheme> = {
  dark: darkTheme,
  light: lightTheme,
};

/**
 * Theme-aware elevation. On dark we return an empty style (depth comes from the
 * gradient + edge-light on the glass recipe); on light we return a soft, tight
 * drop shadow — visible on a light ground where a shadow on black would not be.
 */
export function elevation(theme: AppTheme, level: 1 | 2 = 1): ViewStyle {
  if (theme.name === 'dark') return {};
  const map = {
    1: { radius: 14, opacity: 0.08, offsetY: 4, elevation: 2 },
    2: { radius: 22, opacity: 0.1, offsetY: 8, elevation: 4 },
  } as const;
  const s = map[level];
  return {
    shadowColor: '#141609',
    shadowOpacity: s.opacity,
    shadowRadius: s.radius,
    shadowOffset: { width: 0, height: s.offsetY },
    elevation: s.elevation,
  };
}

/** Build the @react-navigation theme from our tokens so headers/containers match. */
export function toNavigationTheme(theme: AppTheme): NavigationTheme {
  const base = theme.name === 'dark' ? NavDarkTheme : NavLightTheme;
  return {
    ...base,
    dark: theme.name === 'dark',
    colors: {
      ...base.colors,
      background: theme.colors.bg,
      card: theme.colors.bg,
      primary: theme.colors.accentInk,
      border: theme.colors.hairline,
      text: theme.colors.textPrimary,
      notification: theme.colors.accentFill,
    },
  };
}

interface AppThemeContextValue {
  theme: AppTheme;
  name: ThemeName;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

/**
 * Resolves preference + OS appearance into a concrete theme and provides it.
 * `system` stays live: when the OS flips (e.g. at sunset) `useColorScheme()`
 * updates and the whole tree re-themes without a restart.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const value = useMemo<AppThemeContextValue>(() => {
    const resolved: ThemeName =
      preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;
    return {
      theme: themes[resolved],
      name: resolved,
      preference,
      setPreference,
    };
  }, [preference, systemScheme, setPreference]);

  return React.createElement(AppThemeContext.Provider, { value }, children);
}

/**
 * Access the resolved theme + the appearance preference controls.
 * Named `useAppTheme` (not `useTheme`) to avoid colliding with
 * @react-navigation/native's own `useTheme`.
 */
export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    // Fail safe to dark rather than throw, so a component rendered outside the
    // provider (e.g. an isolated test) still gets valid tokens.
    return {
      theme: darkTheme,
      name: 'dark',
      preference: 'system',
      setPreference: () => {},
    };
  }
  return ctx;
}
