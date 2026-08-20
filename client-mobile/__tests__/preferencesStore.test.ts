// client-mobile/__tests__/preferencesStore.test.ts
//
// Regression coverage for the "Default Layout resets on his phone but not
// mine" fix (Phase 85, Batch A/E) — the preference moved out of watchStore's
// (potentially oversized, potentially unreadable) persisted blob into its
// own tiny store, seeded once from whatever's in the old blob so an
// existing user's choice survives the migration.
//
// parseLegacyLayoutFromBlob is tested directly (a pure function) rather
// than driving zustand's async persist/hydration timing end to end — see
// that function's own comment in preferencesStore.ts for why.

import {
  parseLegacyLayoutFromBlob,
  usePreferencesStore,
} from '../store/preferencesStore';

describe('parseLegacyLayoutFromBlob', () => {
  it('carries an existing user\'s grid choice across from the legacy blob', () => {
    const raw = JSON.stringify({ state: { defaultLayout: 'grid', layoutOverrides: { movies: 'list' } } });
    const result = parseLegacyLayoutFromBlob(raw);
    expect(result.defaultLayout).toBe('grid');
    expect(result.layoutOverrides).toEqual({ movies: 'list' });
  });

  it('defaults to list when the legacy blob has no key at all (fresh install)', () => {
    expect(parseLegacyLayoutFromBlob(null)).toEqual({ defaultLayout: 'list', layoutOverrides: {} });
  });

  it('falls back to list, not a thrown error, on malformed JSON — the exact oversized/corrupt-row case this store exists to escape', () => {
    const corrupt = '{"state": {"defaultLayout": "grid", oops this is not valid json';
    expect(() => parseLegacyLayoutFromBlob(corrupt)).not.toThrow();
    expect(parseLegacyLayoutFromBlob(corrupt)).toEqual({ defaultLayout: 'list', layoutOverrides: {} });
  });

  it('ignores a non-"grid" defaultLayout value rather than passing it through blindly', () => {
    const raw = JSON.stringify({ state: { defaultLayout: 'not-a-real-mode' } });
    expect(parseLegacyLayoutFromBlob(raw).defaultLayout).toBe('list');
  });

  it('ignores a malformed layoutOverrides field (wrong type) instead of crashing downstream consumers', () => {
    const raw = JSON.stringify({ state: { defaultLayout: 'grid', layoutOverrides: 'not-an-object' } });
    expect(parseLegacyLayoutFromBlob(raw).layoutOverrides).toEqual({});
  });

  it('defaults cleanly when the blob has a state key but no layout fields at all', () => {
    const raw = JSON.stringify({ state: { someUnrelatedField: 123 } });
    expect(parseLegacyLayoutFromBlob(raw)).toEqual({ defaultLayout: 'list', layoutOverrides: {} });
  });
});

describe('usePreferencesStore', () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      defaultLayout: 'list',
      layoutOverrides: {},
      seededFromLegacyStore: true,
    });
  });

  it('setDefaultLayout clears every per-screen override — a Settings change is felt everywhere immediately', () => {
    usePreferencesStore.setState({ layoutOverrides: { shows: 'grid', movies: 'grid' } });
    usePreferencesStore.getState().setDefaultLayout('grid');
    expect(usePreferencesStore.getState().layoutOverrides).toEqual({});
    expect(usePreferencesStore.getState().defaultLayout).toBe('grid');
  });

  it('setLayoutForScope only touches its own scope, leaving others (and the default) untouched', () => {
    usePreferencesStore.getState().setLayoutForScope('movies', 'grid');
    const state = usePreferencesStore.getState();
    expect(state.layoutOverrides).toEqual({ movies: 'grid' });
    expect(state.defaultLayout).toBe('list');
  });
});
