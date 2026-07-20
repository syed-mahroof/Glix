// client-mobile/store/themeStore.ts
//
// Persists the user's Appearance preference (System / Light / Dark).
// Kept as its own tiny store — separate from the 900-line watchStore — so the
// theme layer has no dependency on watch data and the preference survives a
// relaunch without touching watchStore's partialize. The RESOLVED theme
// (accounting for OS appearance when preference === 'system') is computed in
// lib/theme.ts's AppThemeProvider, not here; this store only holds the choice.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: 'watchtracker-theme',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
