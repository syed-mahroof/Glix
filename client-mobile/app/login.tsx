// client-mobile/app/login.tsx
import axios from 'axios';
import { Link, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Eye, EyeOff, Lock, User } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ACCESS_TOKEN_KEY, API_BASE_URL, REFRESH_TOKEN_KEY } from '../lib/api';
import PressableScale from '../components/PressableScale';
import SocialSignInButtons from '../components/SocialSignInButtons';
import type { SocialAuthResponse } from '../lib/socialAuth';
import { useAppTheme } from '../lib/theme';

function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    return error.message ?? 'Network request failed.';
  }
  return 'An unexpected error occurred.';
}

export default function LoginScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!username.trim() || !password) {
      setError('Enter both username and password.');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/auth/login/`, {
        username: username.trim(),
        password,
      });
      await SecureStore.setItemAsync('access_token', response.data.access);
      await SecureStore.setItemAsync('refresh_token', response.data.refresh);
      router.replace('/loading');
    } catch (err) {
      setError(extractErrorMessage(err));
      setIsSubmitting(false);
    }
  };

  const handleSocialSuccess = async (result: SocialAuthResponse) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, result.access);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, result.refresh);
    router.replace(
      result.created ? { pathname: '/loading', params: { next: '/onboarding' } } : '/loading'
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={[styles.wordmark, { color: c.textPrimary }]}>Glix</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>Sign in to keep tracking.</Text>

          {error && (
            <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
              <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
            </View>
          )}

          <View style={[styles.inputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
            <User color={c.textTertiary} size={18} />
            <TextInput
              style={[styles.input, { color: c.textPrimary }]}
              placeholder="Username"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              editable={!isSubmitting}
            />
          </View>

          <View style={[styles.inputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
            <Lock color={c.textTertiary} size={18} />
            <TextInput
              style={[styles.input, { color: c.textPrimary }]}
              placeholder="Password"
              placeholderTextColor={c.textTertiary}
              secureTextEntry={!isPasswordVisible}
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
              editable={!isSubmitting}
            />
            <PressableScale onPress={() => setIsPasswordVisible((prev) => !prev)} hitSlop={8}>
              {isPasswordVisible ? (
                <EyeOff color={c.textTertiary} size={18} />
              ) : (
                <Eye color={c.textTertiary} size={18} />
              )}
            </PressableScale>
          </View>

          <Link href="/forgot-password" asChild>
            <PressableScale hitSlop={8} style={styles.forgotPasswordRow}>
              <Text style={[styles.forgotPasswordText, { color: c.accentInk }]}>Forgot password?</Text>
            </PressableScale>
          </Link>

          <PressableScale
            style={[
              styles.submitButton,
              { backgroundColor: c.accentFill },
              isSubmitting && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={c.onAccent} />
            ) : (
              <Text style={[styles.submitButtonText, { color: c.onAccent }]}>Sign In</Text>
            )}
          </PressableScale>

          <SocialSignInButtons
            onSuccess={handleSocialSuccess}
            onError={setError}
            disabled={isSubmitting}
          />

          <View style={styles.footerRow}>
            <Text style={[styles.footerText, { color: c.textSecondary }]}>New here?</Text>
            <Link href="/register" asChild>
              <PressableScale hitSlop={8}>
                <Text style={[styles.footerLink, { color: c.accentInk }]}>Create an account</Text>
              </PressableScale>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  wordmark: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 18,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  input: {
    flex: 1,
    fontSize: 15,
  },
  forgotPasswordRow: {
    alignSelf: 'flex-end',
    marginTop: -6,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
  },
  submitButton: {
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  footerText: {
    fontSize: 13,
  },
  footerLink: {
    fontSize: 13,
    fontWeight: '700',
  },
  errorBanner: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
  },
});