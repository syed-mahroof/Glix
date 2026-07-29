// client-mobile/jest.setup.js
// AsyncStorage's real native module doesn't exist under Jest (no RN host
// runtime) — every test that imports store/watchStore.ts transitively
// imports it (for the persist() middleware's storage adapter), so without
// this mock any such test suite fails at import time before a single
// assertion runs. Standard fix documented by the package itself.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
