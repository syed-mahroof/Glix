import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetPayload } from './widgetPayload';

// A small independent snapshot avoids reading the multi-megabyte watch store
// in Android's headless resize task (SQLite CursorWindow limits apply there).
export const WIDGET_STORAGE_KEY = 'glix-widget-snapshot';
interface NativePreferences {
  getItem: (key: string, callback: (value: string | null) => void) => void;
  setItem: (key: string, value: string) => void;
}
let preferences: NativePreferences | null = null;
try {
  const native = require('react-native-shared-preferences');
  preferences = native?.default ?? native;
} catch {
  // Expo Go and web do not provide this native module.
}

function parseSnapshot(raw: string | null): WidgetPayload | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && Array.isArray(value.watchlist) && Array.isArray(value.upcoming)
      && typeof value.syncedAt === 'string' && Number.isFinite(Date.parse(value.syncedAt)) ? value : null;
  } catch { return null; }
}

export async function writeWidgetSnapshot(payload: WidgetPayload): Promise<void> {
  const raw = JSON.stringify(payload);
  // Both stores receive the same snapshot, including authoritative empty and
  // logged-out states. Native writes are synchronous bridge enqueues.
  try { preferences?.setItem('widgetData', raw); } catch { /* AsyncStorage remains available. */ }
  await AsyncStorage.setItem(WIDGET_STORAGE_KEY, raw);
}

export async function readWidgetSnapshot(): Promise<WidgetPayload | null> {
  const nativeRead = new Promise<WidgetPayload | null>((resolve) => {
    if (!preferences?.getItem) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), 750);
    try {
      preferences.getItem('widgetData', (raw) => { clearTimeout(timer); resolve(parseSnapshot(raw)); });
    } catch { clearTimeout(timer); resolve(null); }
  });
  const [native, stored] = await Promise.all([
    nativeRead,
    AsyncStorage.getItem(WIDGET_STORAGE_KEY).then(parseSnapshot).catch(() => null),
  ]);
  if (!native) return stored;
  if (!stored) return native;
  return Date.parse(stored.syncedAt) >= Date.parse(native.syncedAt) ? stored : native;
}
