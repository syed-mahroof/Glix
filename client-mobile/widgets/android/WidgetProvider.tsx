import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { WatchlistWidget } from './WatchlistWidget';
import { UpcomingWidget } from './UpcomingWidget';
import { buildWidgetPayload } from '../../lib/widgetPayload';
import type { WidgetPayload } from '../../lib/widgetPayload';

// Attempt a safe import of SharedPreferences — the native module is only
// available after a full native build (EAS / expo run:android), so during
// Expo Go / dev-client sessions it may be null. We guard every access.
let SharedPreferences: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SharedPreferences = require('react-native-shared-preferences').default;
} catch (_e) {
  // not yet linked — silently continue without widget data persistence
}

async function readSharedPreferences(): Promise<WidgetPayload | null> {
  if (!SharedPreferences) return null;
  return new Promise<WidgetPayload | null>((resolve) => {
    try {
      SharedPreferences.getItem('widgetData', (val: string | null) => {
        if (!val) return resolve(null);
        try {
          resolve(JSON.parse(val));
        } catch {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

/** Fallback source: the Zustand persist blob, which already holds the full
 *  watchlist and survives app kills independently of the SharedPreferences
 *  snapshot. Covers the case a widget is added (or the OS redraws it) before
 *  syncWidgetData() has ever run on this install — previously that rendered
 *  a permanent "Open Glix to sync" card until the user happened to open the
 *  app while it was watching. */
async function readPersistedStore(): Promise<WidgetPayload | null> {
  try {
    const raw = await AsyncStorage.getItem('watchtracker-store');
    if (!raw) return null;
    const state = JSON.parse(raw)?.state;
    const watchlist = state?.watchlist;
    if (!watchlist) return null;
    const nextUp = watchlist.to_watch?.results ?? [];
    const entries = [...nextUp, ...(watchlist.up_to_date?.results ?? [])];
    if (entries.length === 0) return null;
    return buildWidgetPayload(nextUp, entries);
  } catch {
    return null;
  }
}

/** SharedPreferences first (cheapest, written on every successful sync),
 *  the persisted store second. A `loggedOut` snapshot is authoritative and
 *  never falls through — the stale watchlist behind it belongs to the
 *  previous account. */
async function readWidgetData(): Promise<WidgetPayload | null> {
  const cached = await readSharedPreferences();
  if (cached && (cached.loggedOut || (cached.watchlist?.length ?? 0) + (cached.upcoming?.length ?? 0) > 0)) {
    return cached;
  }
  return (await readPersistedStore()) ?? cached;
}

// The normal write side lives in store/watchStore.ts's syncWidgetData() — it
// needs the full watchlist state (Zustand `get()`), which this module has no
// access to while the app is running. This file runs headless: the OS invokes
// it on every widget lifecycle event, app open or not.
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  try {
    // WIDGET_DELETED has nothing to draw; WIDGET_CLICK is already handled by
    // each row's own OPEN_URI/OPEN_APP clickAction, so re-rendering on it
    // would just cost a headless JS round trip for no visual change.
    if (props.widgetAction === 'WIDGET_DELETED' || props.widgetAction === 'WIDGET_CLICK') return;

    const data = await readWidgetData();
    const { widgetName, height } = props.widgetInfo;

    // props.renderWidget is the API that actually fulfils the pending render
    // for THIS widget id. The previous implementation called
    // requestWidgetUpdate() by widget *name* instead, which never satisfied
    // the specific instance the OS was waiting on — so a resize (which fires
    // WIDGET_RESIZED with the new dimensions) frequently left the widget
    // showing its old, wrongly-sized layout or nothing at all.
    switch (widgetName) {
      case 'WatchlistWidget':
        props.renderWidget(<WatchlistWidget data={data} height={height} />);
        break;
      case 'UpcomingWidget':
        props.renderWidget(<UpcomingWidget data={data} height={height} />);
        break;
      default:
        break;
    }
  } catch {
    // Called directly by the native module on every OS-triggered redraw
    // (resize, updatePeriodMillis tick) — a thrown/rejected step here must
    // never crash that callback; the next scheduled redraw retries anyway.
  }
}
