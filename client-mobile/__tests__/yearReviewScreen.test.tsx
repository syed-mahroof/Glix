jest.mock('../lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('../lib/useScreenActive', () => ({ useScreenActive: () => true }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('../components/AmbientGlow', () => () => null);
jest.mock('../components/PressableScale', () => require('react-native').Pressable);
jest.mock('lucide-react-native', () => {
  const Icon = require('react-native').View;
  return { ArrowLeft: Icon, Calendar: Icon, Film: Icon, Flame: Icon, Share2: Icon, Star: Icon, Trophy: Icon, X: Icon, AlertTriangle: Icon, RotateCcw: Icon };
});
jest.mock('../lib/motion', () => ({ usePrefersReducedMotion: () => true, staggerEntering: () => undefined }));
jest.mock('../lib/theme', () => ({ useAppTheme: () => ({ theme: { colors: {
  bg: '#000', accentInk: '#e4fa1a', accentFill: '#e4fa1a', onAccent: '#000', accentDim: '#333',
  textPrimary: '#fff', textSecondary: '#aaa', textTertiary: '#888', glassFill: '#222', hairline: '#333', trackRing: '#444',
} } }) }));
jest.mock('@shopify/flash-list', () => ({ FlashList: require('react-native').FlatList }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn().mockResolvedValue('file:///recap.png'), releaseCapture: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockResolvedValue(undefined) }));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '../lib/api';
import YearReviewScreen from '../app/year-review';
import { useWatchStore, type YearReview, type YearReviewTitle } from '../store/watchStore';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('renders a movie-only recap, its full library, and a selected monthly chapter', async () => {
  const year = new Date().getFullYear();
  const title: YearReviewTitle = { tmdb_id: 100, title: 'Movie highlight', poster_path: null, media_type: 'movie',
    episodes_watched: 0, minutes_watched: 120, watches: 1, rewatches: 0, first_watched: `${year}-01-05`, last_watched: `${year}-01-05`, rating: 4.5 };
  const review: YearReview = { year, hours_watched: 2, episodes_watched: 0, movies_watched: 1, unique_movies: 1,
    movie_hours: 2, series_hours: 0, active_days: 1, first_watch_movies: 1, shows_finished: 0,
    most_watched_show: null, favorite_genre: 'Drama', favorite_actor: null, longest_streak: 1,
    biggest_month: 'January', biggest_week: null, top_shows: [], top_movies: [title], watched_shows: [], watched_movies: [title], top_genres: [],
    months: [{ month: 1, label: 'January', series_minutes: 0, movie_minutes: 120, episodes: 0, movies: 1, rewatches: 0, top_show: null, top_movie: { tmdb_id: 100, title: title.title } }],
  };
  (api.get as jest.Mock).mockResolvedValue({ data: review });
  useWatchStore.setState({ yearReview: review, analyticsDirtyAt: 0, isLoadingYearReview: false, yearReviewError: null });
  await render(<YearReviewScreen />);
  expect(screen.getByText('0 episodes · 1 movie watch')).toBeTruthy();
  expect(screen.queryByText('Your story starts with a watch')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'January: 0 episodes, 1 movie watches' }));
  expect(screen.getByText('January · 2h')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'See all movies · 1' }));
  expect(screen.getByText(`${year} · Your library`)).toBeTruthy();
  expect(screen.getAllByText(/(Jan 5|5 Jan) – (Jan 5|5 Jan)/).length).toBeGreaterThan(0);
}, 30_000);
