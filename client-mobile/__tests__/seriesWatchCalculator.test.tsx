jest.mock('../components/GlassSurface', () => require('react-native').View);
jest.mock('../components/PressableScale', () => require('react-native').Pressable);
jest.mock('lucide-react-native', () => ({
  Calculator: require('react-native').View,
  ChevronDown: require('react-native').View,
  ChevronUp: require('react-native').View,
}));
jest.mock('../lib/theme', () => ({
  useAppTheme: () => ({ theme: { colors: {
    accentInk: '#E4FA1A', accentFill: '#E4FA1A', onAccent: '#000', accentDim: '#202200',
    textPrimary: '#fff', textSecondary: '#aaa', glassFill: '#222', hairline: '#333', negative: '#f44', trackRing: '#444',
  } } }),
}));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import SeriesWatchCalculator from '../components/SeriesWatchCalculator';
import type { Show } from '../store/watchStore';

it('recalculates the visible plan and reports invalid budgets accessibly', async () => {
  const show: Show = {
    tmdb_id: 1, title: 'Series', overview: '', poster_path: null, backdrop_path: null, first_air_date: null,
    status: 'ENDED', vote_average: 8, total_seasons: 1, total_episodes: 3, original_language: 'en', genres: [],
    next_episode_air_date: null, next_episode_season_number: null, next_episode_number: null, next_episode_name: null,
    episodes: [1, 2, 3].map((id) => ({ tmdb_id: id, season_number: 1, episode_number: id, title: 'Episode', air_date: '2020-01-01', runtime_minutes: 45, is_watched: false })),
  };
  await render(<SeriesWatchCalculator show={show} entry={null} />);
  expect(screen.queryByText('3 watch days')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Series watch calculator' }));
  expect(screen.getByText('3 watch days')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Custom minutes per day'), '0');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter 1–1440 minutes.');
  await fireEvent.changeText(screen.getByLabelText('Custom minutes per day'), '90');
  expect(screen.getByText('2 watch days')).toBeTruthy();
});
