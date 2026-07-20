// client-mobile/app/(tabs)/upcoming.tsx
// ⚠️  RETIRED in V2 Refactor – Phase 2 (Shows Hub & Cascade Logic).
//
// This screen has been absorbed into the Shows tab itself:
//   - client-mobile/app/(tabs)/index.tsx
//     (UPCOMING top-level tab, with a nested List/Calendar toggle)
//
// The file is intentionally retained so Expo Router does not throw a 404
// for any cached navigation state. It immediately redirects to the main
// Shows tab.  The tab is hidden from the bottom nav in (tabs)/_layout.tsx
// via `href: null`.

import { Redirect } from 'expo-router';

export default function UpcomingScreen() {
  return <Redirect href="/(tabs)/" />;
}