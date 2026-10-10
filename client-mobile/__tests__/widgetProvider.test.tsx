jest.mock('../lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../lib/widgetStorage', () => ({ readWidgetSnapshot: jest.fn(), writeWidgetSnapshot: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../widgets/android/UpcomingWidget', () => ({ UpcomingWidget: () => null }));
jest.mock('../widgets/android/WatchlistWidget', () => ({ WatchlistWidget: () => null }));
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { api } from '../lib/api';
import { readWidgetSnapshot, writeWidgetSnapshot } from '../lib/widgetStorage';
import { widgetTaskHandler } from '../widgets/android/WidgetProvider';
const payload = { watchlist: [], upcoming: [{ id: 100, title: 'Show', next_episode: 'S1 E1', air_date: '2026-10-12' }], syncedAt: '2026-10-01T00:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
  (readWidgetSnapshot as jest.Mock).mockResolvedValue(payload);
});
function props(action: string, height: number) {
  return { widgetAction: action, widgetInfo: { widgetName: 'UpcomingWidget', height, width: 300, widgetId: 1 }, renderWidget: jest.fn() } as unknown as WidgetTaskHandlerProps;
}

it.each([140, 400])('renders saved content at height %i without opening the app or fetching', async (height) => {
  const task = props('WIDGET_RESIZED', height);
  await widgetTaskHandler(task);
  expect(task.renderWidget).toHaveBeenCalledTimes(1);
  expect((task.renderWidget as jest.Mock).mock.calls[0][0].props.data).toEqual(payload);
  expect(api.get).not.toHaveBeenCalled();
});

it('paints the cache before a slow background request and retains it offline', async () => {
  let reject: (err: Error) => void = () => {};
  (api.get as jest.Mock).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const task = props('WIDGET_UPDATE', 140);
  const work = widgetTaskHandler(task);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(task.renderWidget).toHaveBeenCalled();
  reject(new Error('Offline'));
  await work;
  expect(task.renderWidget).toHaveBeenCalledTimes(1);
});

it('does not restore private content when logout occurs during a refresh', async () => {
  const cleared = { watchlist: [], upcoming: [], loggedOut: true, syncedAt: new Date().toISOString() };
  (readWidgetSnapshot as jest.Mock).mockResolvedValueOnce(payload).mockResolvedValueOnce(cleared);
  (api.get as jest.Mock).mockResolvedValue({ data: { to_watch: { results: [] }, up_to_date: { results: [] } } });
  const task = props('WIDGET_UPDATE', 140);
  await widgetTaskHandler(task);
  expect(writeWidgetSnapshot).not.toHaveBeenCalled();
  expect((task.renderWidget as jest.Mock).mock.calls.at(-1)[0].props.data.loggedOut).toBe(true);
});
