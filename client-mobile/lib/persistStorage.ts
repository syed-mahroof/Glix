// client-mobile/lib/persistStorage.ts
// Debounced PersistStorage for zustand `persist` middleware.
//
// zustand's own `createJSONStorage` wraps a plain string-based StateStorage
// — but it calls JSON.stringify(partialize(state)) itself, synchronously,
// before ever handing the result to the adapter. Debouncing the adapter
// (e.g. wrapping AsyncStorage) does nothing for that: the stringify — the
// actual blocking work, run on every optimistic + server-confirm `set()` —
// already happened. Implementing PersistStorage<S> directly instead means
// `setItem` receives the un-serialized value, so the stringify itself can be
// deferred and coalesced along with the I/O.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InteractionManager } from 'react-native';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

const DEBOUNCE_MS = 600;

// Phase 83 (C13): originally single-instance module state, used only by
// watchStore. Adding persistence to discoverStore/socialStore/listsStore
// meant multiple concurrent createDebouncedStorage() instances — sharing
// one pendingName/pendingValue/timer across them meant a write to one store
// inside the same 600ms window silently clobbered another's still-pending
// write. Each call now gets its own closure-scoped pending state; a
// module-level registry of per-instance flush functions is what lets the
// single exported flushPersist() still force out every instance's pending
// write, not just the most recently created one.
const pendingFlushes = new Set<() => void>();

/** Forces every pending debounced write (across all stores using this
 *  storage) out immediately — call before the app might be suspended
 *  (AppState background) or before state a write targets is about to
 *  become stale (logout). */
export function flushPersist(): void {
  for (const flush of pendingFlushes) flush();
}

// Per-instance hydration setters, keyed by the exact `PersistStorage<S>`
// object createDebouncedStorage() handed back — see markStorageHydrated
// below for why this indirection exists instead of a method on that object.
const hydrationSetters = new WeakMap<PersistStorage<unknown>, () => void>();

/** Call once a store's hydration has resolved (from that store's
 *  `onRehydrateStorage`, which zustand calls on both success and failure —
 *  see middleware.js) to unblock the write gate on the exact
 *  createDebouncedStorage() instance passed in.
 *
 *  Generic (not a fixed `PersistStorage<unknown>` parameter) so each call
 *  site infers its own S/R independently rather than being checked
 *  contravariantly against one fixed parameter type — a concretely-typed
 *  storage (e.g. this file's own tests, which instantiate
 *  createDebouncedStorage<{ count: number }>() explicitly) would otherwise
 *  fail to pass here even though it's the exact same object markHydrated
 *  needs to flip. */
export function markStorageHydrated<S, R = unknown>(storage: PersistStorage<S, R>): void {
  hydrationSetters.get(storage as PersistStorage<unknown>)?.();
}

/** A trailing-only debounce: rapid `set()` calls (optimistic + confirm, or a
 *  bulk toggle) collapse into a single AsyncStorage write DEBOUNCE_MS after
 *  the last one, deferred past the current interaction via
 *  InteractionManager so it never lands mid-scroll/mid-animation.
 *
 *  Bug fix (2026-08-07, "Default layout resets on relaunch"): zustand's
 *  `persist` middleware calls `storage.setItem()` on every single `set()`,
 *  including the ones a store's own boot sequence fires (loading.tsx's
 *  clearError(), fetchWatchlist()'s isLoading flag, etc.) — all of which
 *  race `getItem()`'s AsyncStorage read on cold start. Those early calls
 *  snapshot whatever the store's field initializers say (e.g.
 *  `defaultLayout: 'list'`) because hydration hasn't resolved yet; this
 *  adapter then debounces and writes that STALE snapshot up to 600ms later,
 *  clobbering the real persisted value with the pre-hydration default.
 *  Hydration's own `set(stateFromStorage, true)` restores the correct value
 *  in memory but — per zustand's own middleware.js — only re-triggers a
 *  storage write if a version migration ran, so nothing corrects the
 *  now-queued stale write on a plain (non-migrating) rehydrate. Gating
 *  writes until each store instance reports its own hydration finished
 *  (call `markHydrated()` from that store's `onRehydrateStorage`) closes the
 *  window: every write skipped here is one that only ever contained
 *  not-yet-hydrated defaults, so skipping it can't lose real data — the
 *  value already on disk is at least as current as what's being dropped.
 *
 *  The return type here is deliberately still the plain `PersistStorage<S>`
 *  zustand expects, even though the object returned at runtime carries an
 *  extra `markHydrated` method — widening the DECLARED return type to
 *  `PersistStorage<S> & { markHydrated: () => void }` (tried first) changed
 *  what TypeScript infers `storage:` as inside every consuming store's
 *  `persist(...)` call, which broke its generic inference for that store's
 *  unrelated `partialize`/`migrate` callbacks (five new TS2322 errors
 *  appeared across discoverStore/listsStore/socialStore/watchStore,
 *  confirmed by reverting just this type change and watching them vanish).
 *  `markStorageHydrated` below is the one place that knows about the extra
 *  method instead. */
export function createDebouncedStorage<S>(): PersistStorage<S> {
  let pendingName: string | null = null;
  let pendingValue: StorageValue<unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hydrated = false;

  function writeNow(): void {
    const name = pendingName;
    const value = pendingValue;
    pendingName = null;
    pendingValue = null;
    if (name == null || value == null) return;
    InteractionManager.runAfterInteractions(() => {
      AsyncStorage.setItem(name, JSON.stringify(value)).catch((error) => {
        console.warn('Failed to persist store', error);
      });
    });
  }

  function flushThisInstance(): void {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    writeNow();
  }
  pendingFlushes.add(flushThisInstance);

  const storage: PersistStorage<S> = {
    getItem: async (name) => {
      const raw = await AsyncStorage.getItem(name);
      return raw == null ? null : (JSON.parse(raw) as StorageValue<S>);
    },
    setItem: (name, value) => {
      // Pre-hydration write — see the bug-fix note above. Not queued at all
      // (not even a no-op timer): the next post-hydration set() supersedes
      // it, and if none ever comes this session, the on-disk value (already
      // at least as current) is exactly what should survive anyway.
      if (!hydrated) return;
      pendingName = name;
      pendingValue = value as StorageValue<unknown>;
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        writeNow();
      }, DEBOUNCE_MS);
    },
    removeItem: (name) => {
      // Cancel first — a pending write landing after this would resurrect
      // the data clearStorage() just asked to delete.
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingName = null;
      pendingValue = null;
      AsyncStorage.removeItem(name).catch(() => {});
    },
  };
  hydrationSetters.set(storage as PersistStorage<unknown>, () => {
    hydrated = true;
  });
  return storage;
}
