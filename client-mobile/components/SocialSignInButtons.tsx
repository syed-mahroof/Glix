// client-mobile/components/SocialSignInButtons.tsx
// "Or continue with" divider + Google/Apple sign-in, rendered via each
// provider's own official button component (AppleAuthenticationButton,
// GoogleSigninButton) rather than a hand-built brand mark — this repo
// has no bundled Google/Apple logo asset, and using the providers' own
// components is both simpler and guarantees guideline compliance (Apple
// App Store 4.8 requires equivalent prominence, not a specific widget,
// but their own button is the safest way to satisfy that). Apple's
// button only renders on iOS; gated behind isAvailableAsync() too, since
// it can be unavailable even on iOS (e.g. below iOS 13, or in Expo Go —
// this app already requires an EAS dev client for its widget modules,
// so that's expected, not a bug to work around).
import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { GoogleSigninButton } from '@react-native-google-signin/google-signin';

import { extractErrorMessage } from '../lib/errors';
import { signInWithApple, signInWithGoogle, type SocialAuthResponse } from '../lib/socialAuth';
import { useAppTheme } from '../lib/theme';

interface SocialSignInButtonsProps {
  onSuccess: (result: SocialAuthResponse) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export default function SocialSignInButtons({ onSuccess, onError, disabled }: SocialSignInButtonsProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const isDark = theme.name === 'dark';

  const [isAppleAvailable, setIsAppleAvailable] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<'google' | 'apple' | null>(null);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setIsAppleAvailable);
    }
  }, []);

  const isBusy = disabled || pendingProvider !== null;

  const handleGoogle = async () => {
    if (isBusy) return; // AppleAuthenticationButton has no `disabled` prop to guard this natively
    setPendingProvider('google');
    try {
      const result = await signInWithGoogle();
      if (result) onSuccess(result);
    } catch (err) {
      onError(extractErrorMessage(err));
    } finally {
      setPendingProvider(null);
    }
  };

  const handleApple = async () => {
    if (isBusy) return;
    setPendingProvider('apple');
    try {
      const result = await signInWithApple();
      if (result) onSuccess(result);
    } catch (err) {
      onError(extractErrorMessage(err));
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: c.hairline }]} />
        <Text style={[styles.dividerText, { color: c.textTertiary }]}>or continue with</Text>
        <View style={[styles.dividerLine, { backgroundColor: c.hairline }]} />
      </View>

      <View style={styles.buttonStack}>
        {pendingProvider === 'google' ? (
          <View style={[styles.loadingRow, { borderColor: c.hairline }]}>
            <ActivityIndicator color={c.textSecondary} />
          </View>
        ) : (
          <GoogleSigninButton
            size={GoogleSigninButton.Size.Wide}
            color={isDark ? GoogleSigninButton.Color.Light : GoogleSigninButton.Color.Dark}
            onPress={handleGoogle}
            disabled={isBusy}
            style={styles.googleButton}
          />
        )}

        {Platform.OS === 'ios' && isAppleAvailable && (
          pendingProvider === 'apple' ? (
            <View style={[styles.loadingRow, { borderColor: c.hairline }]}>
              <ActivityIndicator color={c.textSecondary} />
            </View>
          ) : (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                isDark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={14}
              style={styles.appleButton}
              onPress={handleApple}
            />
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  buttonStack: {
    gap: 10,
  },
  googleButton: {
    width: '100%',
    height: 52,
  },
  appleButton: {
    width: '100%',
    height: 52,
  },
  loadingRow: {
    height: 52,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
