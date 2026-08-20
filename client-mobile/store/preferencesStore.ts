// client-mobile/store/preferencesStore.ts
//
// Small, self-contained UI preferences — currently the Settings > Appearance
// "Default layout" choice and the per-screen list/grid overrides it seeds.
//
// Bug fix (2026-08-21, "Default layout resets on his phone but not mine"):
// these two fields used to live in watchStore, which means they were written
// into the `watchtracker-store` AsyncStorage row — the same row that also
// carries the ENTIRE watchlist (every cached episode of every tracked show)
// plus movieWatchlist. On a large library that single row runs to several
// megabytes, and on Android AsyncStorage is SQLite-backed: reading an
// oversized row fails. zustand then resolves hydration as a FAILURE, the
// store keeps its field initializers (`defaultLayout: 'list'`), and because
// onRehydrateStorage fires on failure too the write gate opens and the next
// mutation persists those defaults over whatever was there. The user sees
// "my layout keeps resetting" — on the phone with the big library only,
// which is exactly the reported shape. Theme survived on the same device
// because themeStore already had its own tiny key; this store is modelled on
// it deliberately. A preference must never share a storage row with bulk data.
//
// Same reasoning applies to anything added here later: keep it small enough
// that the row can always be read back.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type LayoutMode = 'list' | 'grid';
/** One entry per screen that owns its own list/grid choice. */
export type LayoutScope = 'shows' | 'movies' | 'myShows' | 'myMovies' | 'myAnime';

/** The key watchStore persists under — read once, for the migration below. */
const LEGACY_WATCH_STORE_KEY = 'watchtracker-store';

interface PreferencesState {
  /** App-wide default (Settings > Appearance), plus a per-screen override
   *  map — Shows Hub, Movies Hub, Profile > My Shows/My Movies/My Anime can
   *  each pick their own layout without disturbing the others or the
   *  default. Read via useLayoutFor(scope) rather than these fields
   *  directly. */
  defaultLayout: LayoutMode;
  layoutOverrides: Partial<Record<LayoutScope, LayoutMode>>;
  /** True once the one-time read out of the legacy watchStore blob has been
   *  attempted (successfully or not), so it never runs a second time. */
  seededFromLegacyStore: boolean;

  /** Sets the app-wide default AND clears every per-screen override, so a
   *  Settings change is felt everywhere immediately rather than being masked
   *  by whatever overrides happen to already exist. */
  setDefaultLayout: (mode: LayoutMode) => void;
  setLayoutForScope: (scope: LayoutScope, mode: LayoutMode) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      defaultLayout: 'list',
      layoutOverrides: {},
      seededFromLegacyStore: false,

      setDefaultLayout: (mode) =>
        set({ defaultLayout: mode, layoutOverrides: {}, seededFromLegacyStore: true }),
      setLayoutForScope: (scope, mode) =>
        set((state) => ({
          layoutOverrides: { ...state.layoutOverrides, [scope]: mode },
          seededFromLegacyStore: true,
        })),
    }),
    {
      name: 'watchtracker-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // Nothing persisted here yet — this is either a first-ever install or
        // an existing user upgrading from the version that kept these two
        // fields inside watchStore. Try to carry their choice across so the
        // upgrade isn't itself a silent reset. Fire-and-forget: a failure
        // (including the oversized-row read failure this whole store exists
        // to escape) just leaves the defaults in place.
        if (state?.seededFromLegacyStore) return;
        seedFromLegacyWatchStore();
      },
    }
  )
);

/** Pure parse step, split out of seedFromLegacyWatchStore() so the actual
 *  interesting logic (malformed JSON, missing fields, wrong types) is
 *  directly unit-testable without needing to drive zustand's async
 *  hydration timing — see __tests__/preferencesStore.test.ts. Never throws:
 *  any parse failure degrades to the same defaults a first-ever install
 *  would start with. */
export function parseLegacyLayoutFromBlob(
  raw: string | null
): Pick<PreferencesState, 'defaultLayout' | 'layoutOverrides'> {
  const fallback = { defaultLayout: 'list' as LayoutMode, layoutOverrides: {} };
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw) as { state?: Partial<PreferencesState> };
    const legacyDefault = parsed?.state?.defaultLayout;
    const legacyOverrides = parsed?.state?.layoutOverrides;
    return {
      defaultLayout: legacyDefault === 'grid' ? 'grid' : 'list',
      layoutOverrides:
        legacyOverrides && typeof legacyOverrides === 'object' ? legacyOverrides : {},
    };
  } catch {
    // Malformed JSON — the exact "oversized/corrupt row" case this whole
    // store exists to route around (see file header). Same fallback as a
    // missing key, not a thrown error.
    return fallback;
  }
}

async function seedFromLegacyWatchStore(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_WATCH_STORE_KEY);
    const { defaultLayout, layoutOverrides } = parseLegacyLayoutFromBlob(raw);
    usePreferencesStore.setState({ defaultLayout, layoutOverrides, seededFromLegacyStore: true });
  } catch (error) {
    // AsyncStorage.getItem itself rejecting — distinct from parseLegacyLayoutFromBlob's
    // handled JSON-parse failure above. Marking it seeded anyway is
    // deliberate: retrying a read that structurally cannot succeed on every
    // launch would just burn startup time to reach the same defaults.
    console.warn('Could not read layout preference from legacy store', error);
    usePreferencesStore.setState({ seededFromLegacyStore: true });
  }
}

/** The effective layout for one screen — its own override if it's set one,
 *  else the app-wide default (Settings > Appearance). Two separate scoped
 *  selectors rather than one combined one, so a screen only re-renders when
 *  the piece of state it actually depends on changes. */
export function useLayoutFor(scope: LayoutScope): LayoutMode {
  const defaultLayout = usePreferencesStore((s) => s.defaultLayout);
  const override = usePreferencesStore((s) => s.layoutOverrides[scope]);
  return override ?? defaultLayout;
}
