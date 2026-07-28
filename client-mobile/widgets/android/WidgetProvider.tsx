import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { WatchlistWidget } from './WatchlistWidget';
import { UpcomingWidget } from './UpcomingWidget';
import { api } from '../../lib/api';
import { buildWidgetPayload } from '../../lib/widgetPayload';
import type { WidgetPayload } from '../../lib/widgetPayload';
import type { WatchlistEntry } from '../../store/watchStore';

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

interface WatchlistBucketsResponse {
  to_watch: { results: WatchlistEntry[] };
  up_to_date: { results: WatchlistEntry[] };
  archived: { results: WatchlistEntry[] };
}

// The native headless task itself is hard-killed at ~30s
// (RNWidgetBackgroundTaskWorker.java) and the backend's free-tier dyno can
// take 20-50s to wake from cold — comfortably longer than that ceiling. This
// stays well clear of it so a slow/cold backend falls back to the cached
// read below instead of the whole redraw getting killed mid-request.
const BACKGROUND_FETCH_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('widget background fetch timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Genuinely refreshes the widget's data over the network when the OS wakes
 *  this headless task. Previously widgetTaskHandler only ever re-rendered
 *  whatever the foreground app last wrote via syncWidgetData() — a widget
 *  could go stale, or stay on "Open Glix to sync" indefinitely, for as long
 *  as the app stayed closed, since nothing else ever refreshed the
 *  underlying data. `api`'s request interceptor (lib/api.ts) attaches the
 *  SecureStore-backed access token the same way it does for any in-app
 *  request — no separate auth path needed here. Returns null on any
 *  failure (offline, dead refresh token, or the bounded timeout above
 *  tripping) so the caller falls back to the cached read instead of
 *  crashing the redraw. */
async function fetchFreshWidgetData(): Promise<WidgetPayload | null> {
  try {
    const response = await withTimeout(
      api.get<WatchlistBucketsResponse>('/watchlist/?page_size=all'),
      BACKGROUND_FETCH_TIMEOUT_MS
    );
    const { to_watch, up_to_date } = response.data;
    const entries = [...to_watch.results, ...up_to_date.results];
    const payload = buildWidgetPayload(to_watch.results, entries);
    if (SharedPreferences) {
      SharedPreferences.setItem('widgetData', JSON.stringify(payload));
    }
    return payload;
  } catch {
    return null;
  }
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

    // Periodic tick (WIDGET_UPDATE, driven by app.json's updatePeriodMillis)
    // and a freshly-added widget are both worth a network round trip — this
    // is precisely the "app hasn't been opened in a while" case a stale
    // cache can't fix. A resize is purely a layout event (the user is
    // mid-drag), so it redraws from whatever's already cached rather than
    // adding a network round trip to every resize frame.
    const shouldRefetch = props.widgetAction === 'WIDGET_UPDATE' || props.widgetAction === 'WIDGET_ADDED';
    const data = (shouldRefetch ? await fetchFreshWidgetData() : null) ?? (await readWidgetData());
    const { widgetName } = props.widgetInfo;

    // props.renderWidget is the API that actually fulfils the pending render
    // for THIS widget id. The previous implementation called
    // requestWidgetUpdate() by widget *name* instead, which never satisfied
    // the specific instance the OS was waiting on — so a resize (which fires
    // WIDGET_RESIZED with the new dimensions) frequently left the widget
    // showing its old, wrongly-sized layout or nothing at all.
    switch (widgetName) {
      case 'WatchlistWidget':
        props.renderWidget(<WatchlistWidget data={data} />);
        break;
      case 'UpcomingWidget':
        props.renderWidget(<UpcomingWidget data={data} />);
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
