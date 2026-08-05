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

/** A trailing-only debounce: rapid `set()` calls (optimistic + confirm, or a
 *  bulk toggle) collapse into a single AsyncStorage write DEBOUNCE_MS after
 *  the last one, deferred past the current interaction via
 *  InteractionManager so it never lands mid-scroll/mid-animation. */
export function createDebouncedStorage<S>(): PersistStorage<S> {
  let pendingName: string | null = null;
  let pendingValue: StorageValue<unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  return {
    getItem: async (name) => {
      const raw = await AsyncStorage.getItem(name);
      return raw == null ? null : (JSON.parse(raw) as StorageValue<S>);
    },
    setItem: (name, value) => {
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
}
