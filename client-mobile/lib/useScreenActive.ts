import { useIsFocused } from '@react-navigation/native';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

const foreground = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
const subscribe = (notify: () => void) => {
  const subscription = AppState.addEventListener('change', notify);
  return () => subscription.remove();
};

export function useScreenActive(): boolean {
  const focused = useIsFocused();
  const active = useSyncExternalStore(subscribe, foreground, () => true);
  return focused && active;
}
