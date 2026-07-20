// client-mobile/plugins/withExcludeLegacySupportLibs.js
//
// Fixes an EAS Android build failure in :app:mergeDebugResources:
//   Duplicate value for resource 'attr/actionBarSize' with config 'DEFAULT'
//
// ROOT CAUSE (confirmed by a local `:app:dependencies` + `:app:mergeDebugResources`
// run, not guessed): react-native-shared-preferences@1.0.2 declares a vestigial
//   implementation "com.android.support:appcompat-v7:23.0.1"
// in its android/build.gradle — pre-AndroidX boilerplate from the old RN native
// module template. Its own Java imports ZERO android.support.* classes (it only
// uses the framework android.content.SharedPreferences), so the dependency is
// dead weight. But its resources still get merged: the 2015-era support library
// ships <declare-styleable name="Theme"> with a FULL attr/actionBarSize
// definition, which collides with AndroidX appcompat-1.7.0's own full
// <declare-styleable name="AppCompatTheme"> actionBarSize definition. Two full
// definitions of the same attr = AAPT2 hard duplicate, and the merge dies.
//
// This was NOT a Material/appcompat version conflict — the dependency graph
// already resolves to a single unified appcompat 1.7.0 / material 1.12.0, and
// forcing those versions had zero effect across three failed builds. The
// offender is a completely separate legacy artifact that no version pin touched.
//
// FIX 1: exclude the entire com.android.support group from every configuration.
// The app is fully AndroidX (android.useAndroidX=true) and nothing legitimately
// uses the pre-AndroidX support stack, so stripping it is safe and complete.
// There's no managed-Expo (expo-build-properties) option for a Gradle
// `exclude group`, so this injects it into the generated android/build.gradle
// during prebuild.
//
// FIX 2: align androidx.work. WorkManager 2.8.0 merged the work-runtime-ktx
// Kotlin extension classes (OneTimeWorkRequestKt, PeriodicWorkRequestKt, ...)
// into the main work-runtime artifact. react-native-android-widget still pulls
// the old standalone work-runtime-ktx:2.7.1, while the rest of the graph resolves
// work-runtime to 2.8.1 — so those *Kt classes exist in BOTH artifacts and
// :app:checkDebugDuplicateClasses fails ("Duplicate class androidx.work.*Kt").
// Pinning both artifacts to 2.8.1 makes the ktx artifact resolve to its empty
// 2.8.1 stub, removing the duplicate without downgrading the runtime.
const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARKER = 'exclude group: \'com.android.support\'';
const EXCLUDE_BLOCK = `
// Injected by plugins/withExcludeLegacySupportLibs.js.
// (1) strips the pre-AndroidX support library that react-native-shared-preferences
//     drags in, which collides with AndroidX appcompat on attr/actionBarSize during
//     mergeDebugResources.
// (2) pins androidx.work so the stale work-runtime-ktx:2.7.1 from
//     react-native-android-widget can't duplicate the *Kt classes that WorkManager
//     2.8.0 merged into work-runtime (checkDebugDuplicateClasses).
allprojects {
    configurations.all {
        exclude group: 'com.android.support'
        resolutionStrategy {
            force 'androidx.work:work-runtime:2.8.1'
            force 'androidx.work:work-runtime-ktx:2.8.1'
        }
    }
}
`;

module.exports = function withExcludeLegacySupportLibs(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withExcludeLegacySupportLibs only supports Groovy build.gradle files');
    }
    if (!config.modResults.contents.includes(MARKER)) {
      config.modResults.contents += EXCLUDE_BLOCK;
    }
    return config;
  });
};
