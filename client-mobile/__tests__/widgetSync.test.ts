jest.mock('../lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../lib/widgetStorage', () => ({ writeWidgetSnapshot: jest.fn().mockResolvedValue(undefined) }));
jest.mock('react-native-android-widget', () => ({ requestWidgetUpdate: jest.fn().mockResolvedValue(undefined) }));
import { Platform } from 'react-native';
import { api } from '../lib/api';
import { writeWidgetSnapshot } from '../lib/widgetStorage';
import { useWatchStore } from '../store/watchStore';

it('preserves the saved widget during cold hydration but accepts an authoritative empty response', async () => {
  jest.useFakeTimers();
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  const hydrated = jest.spyOn(useWatchStore.persist, 'hasHydrated').mockReturnValue(false);
  try {
    await useWatchStore.getState().syncWidgetData();
    expect(writeWidgetSnapshot).not.toHaveBeenCalled();
    (api.get as jest.Mock).mockResolvedValue({ data: useWatchStore.getState().watchlist });
    await useWatchStore.getState().fetchWatchlist();
    expect(writeWidgetSnapshot).toHaveBeenCalledWith(expect.objectContaining({ watchlist: [], upcoming: [] }));
    await useWatchStore.getState().clearWidgetData();
    const writes = (writeWidgetSnapshot as jest.Mock).mock.calls.length;
    await useWatchStore.getState().syncWidgetData();
    expect(writeWidgetSnapshot).toHaveBeenCalledTimes(writes);
    expect((writeWidgetSnapshot as jest.Mock).mock.calls.at(-1)[0].loggedOut).toBe(true);
  } finally {
    hydrated.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    jest.useRealTimers();
  }
});
