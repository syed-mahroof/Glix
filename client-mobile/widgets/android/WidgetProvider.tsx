import React from 'react';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { WatchlistWidget } from './WatchlistWidget';
import { UpcomingWidget } from './UpcomingWidget';

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

async function readWidgetData(): Promise<any> {
  if (!SharedPreferences) return null;
  return new Promise<any>((resolve) => {
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

// The actual write side lives in store/watchStore.ts's syncWidgetData() —
// it needs the full watchlist state (Zustand `get()`), which this module
// has no access to. This file only ever reads the key back for rendering.
export async function widgetTaskHandler(props: any) {
  try {
    const data = await readWidgetData();
    const widgetInfo = props.widgetInfo;

    switch (widgetInfo.widgetName) {
      case 'WatchlistWidget':
        requestWidgetUpdate({
          widgetName: 'WatchlistWidget',
          renderWidget: () => <WatchlistWidget data={data} />,
          widgetNotFound: () => {},
        }).catch(() => {});
        break;

      case 'UpcomingWidget':
        requestWidgetUpdate({
          widgetName: 'UpcomingWidget',
          renderWidget: () => <UpcomingWidget data={data} />,
          widgetNotFound: () => {},
        }).catch(() => {});
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
