// FlashList v2 preserves measured layout objects when it changes between its
// linear (one-column) and grid layout managers. Grid measurements include a
// row-level minHeight so uneven card captions align. That minHeight is not
// valid for a later linear list: it leaves grid-sized empty cells between
// compact rows. Clear the library's layout cache immediately before the
// layout prop changes, while retaining the list instance, scroll container,
// image cache, and normal recycling.

import type { LayoutMode } from '../store/watchStore';

export interface FlashListLayoutCacheRef {
  current: { clearLayoutCacheOnUpdate: () => void } | null;
}

/**
 * Invalidates FlashList's measurements only when a screen changes list/grid
 * mode. FlashList documents this imperative call as a pre-render operation;
 * callers intentionally invoke it while rendering the new mode, not from an
 * effect after stale cells have already been committed.
 */
export function clearFlashListLayoutCacheOnChange(
  previousLayout: LayoutMode,
  nextLayout: LayoutMode,
  listRef: FlashListLayoutCacheRef
): LayoutMode {
  if (previousLayout !== nextLayout) {
    if (listRef.current) {
      listRef.current.clearLayoutCacheOnUpdate();
      return nextLayout;
    }
    return previousLayout;
  }
  return nextLayout;
}

