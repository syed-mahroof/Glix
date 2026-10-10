jest.mock('react-native-shared-preferences', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readWidgetSnapshot, writeWidgetSnapshot, WIDGET_STORAGE_KEY } from '../lib/widgetStorage';
const native = require('react-native-shared-preferences');
const payload = { watchlist: [], upcoming: [{ id: 100, episode_id: 1, title: 'Show', poster_path: null, next_episode: 'S1 E1', air_date: '2026-10-12' }], syncedAt: '2026-10-10T00:00:00Z' };

beforeEach(async () => {
  await AsyncStorage.clear();
  native.getItem.mockReset().mockImplementation((_key: string, callback: (value: string | null) => void) => callback(null));
  native.setItem.mockReset();
});

it('supports the native CommonJS export and a small durable snapshot', async () => {
  await writeWidgetSnapshot(payload);
  expect(native.setItem).toHaveBeenCalledWith('widgetData', JSON.stringify(payload));
  await expect(readWidgetSnapshot()).resolves.toEqual(payload);
  expect(await AsyncStorage.getItem(WIDGET_STORAGE_KEY)).toBe(JSON.stringify(payload));
});

it('keeps an authoritative empty/logout snapshot over older native content', async () => {
  native.getItem.mockImplementation((_key: string, callback: (value: string) => void) => callback(JSON.stringify(payload)));
  const cleared = { watchlist: [], upcoming: [], loggedOut: true, syncedAt: '2026-10-11T00:00:00Z' };
  await writeWidgetSnapshot(cleared);
  await expect(readWidgetSnapshot()).resolves.toEqual(cleared);
});

it('recovers from corrupt native content using the independent snapshot', async () => {
  native.getItem.mockImplementation((_key: string, callback: (value: string) => void) => callback('{broken'));
  await writeWidgetSnapshot(payload);
  await expect(readWidgetSnapshot()).resolves.toEqual(payload);
});

it('bounds a stuck native callback so resize can still draw', async () => {
  jest.useFakeTimers();
  try {
    native.getItem.mockImplementation(() => {});
    await writeWidgetSnapshot(payload);
    const read = readWidgetSnapshot();
    await jest.advanceTimersByTimeAsync(750);
    await expect(read).resolves.toEqual(payload);
  } finally { jest.useRealTimers(); }
});
