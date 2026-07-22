// client-mobile/lib/navigation.ts
import type { Router } from 'expo-router';

// Screens reachable from outside the tab stack -- currently `show/[id]` via
// the widget's `watchtracker://show/{id}` deep link (widgets/android/*.tsx) --
// can end up as the only entry in the navigation history. router.back() then
// silently no-ops, trapping the user on that screen with no way out but a
// force-quit. Falls back to the Home tab whenever there's nowhere to pop to.
export function goBack(router: Pick<Router, 'back' | 'canGoBack' | 'replace'>) {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(tabs)');
  }
}
