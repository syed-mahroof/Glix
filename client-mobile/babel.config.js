module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets-core/plugin removed (2026-08-07): the package
    // is not imported anywhere in app/, components/, lib/, store/, or
    // widgets/ (verified by grep) — a leftover dependency running a second,
    // redundant worklet Babel transform over every file on top of
    // react-native-reanimated/plugin (which already provides its own
    // worklet transform, from react-native-worklets under the hood in
    // Reanimated 4). Pure build-time cost with nothing depending on it.
    plugins: ['react-native-reanimated/plugin'],
  };
};
