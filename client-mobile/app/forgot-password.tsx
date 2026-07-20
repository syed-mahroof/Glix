// client-mobile/app/forgot-password.tsx
import axios from 'axios';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { ArrowLeft, Lock, Mail, ShieldCheck } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
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
import { useAppTheme } from '../lib/theme';

const RESEND_COOLDOWN_SECONDS = 60;

function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    const data = error.response?.data;
    if (data && typeof data === 'object') {
      const firstKey = Object.keys(data)[0];
      if (firstKey && Array.isArray(data[firstKey])) {
        return `${firstKey}: ${data[firstKey][0]}`;
      }
    }
    return error.message ?? 'Network request failed.';
  }
  return 'An unexpected error occurred.';
}

type Step = 'email' | 'code' | 'password';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      await axios.post(`${API_BASE_URL}/auth/password-reset/request/`, {
        email: email.trim(),
      });
      setInfo('If that email is registered, a 6-digit code has been sent.');
      startCooldown();
      setStep('code');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setIsSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      await axios.post(`${API_BASE_URL}/auth/password-reset/request/`, {
        email: email.trim(),
      });
      setInfo('New code sent.');
      startCooldown();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyCode = async () => {
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/auth/password-reset/verify/`, {
        email: email.trim(),
        code: code.trim(),
      });
      setResetToken(response.data.reset_token);
      setStep('password');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/auth/password-reset/confirm/`, {
        reset_token: resetToken,
        new_password: newPassword,
      });
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, response.data.access);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, response.data.refresh);
      router.replace('/loading');
    } catch (err) {
      setError(extractErrorMessage(err));
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
            <ArrowLeft color={c.textPrimary} size={22} />
          </PressableScale>

          <Text style={[styles.title, { color: c.textPrimary }]}>
            {step === 'email' && 'Reset your password'}
            {step === 'code' && 'Check your email'}
            {step === 'password' && 'Choose a new password'}
          </Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            {step === 'email' && "Enter the email on your account and we'll send a verification code."}
            {step === 'code' && `Enter the 6-digit code we sent to ${email.trim()}.`}
            {step === 'password' && 'Your code is verified. Set a new password to finish.'}
          </Text>

          {error && (
            <View style={[styles.banner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
              <Text style={[styles.bannerText, { color: c.negative }]}>{error}</Text>
            </View>
          )}
          {info && !error && (
            <View style={[styles.banner, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
              <Text style={[styles.bannerText, { color: c.textSecondary }]}>{info}</Text>
            </View>
          )}

          {step === 'email' && (
            <>
              <View style={[styles.inputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <Mail color={c.textTertiary} size={18} />
                <TextInput
                  style={[styles.input, { color: c.textPrimary }]}
                  placeholder="Email"
                  placeholderTextColor={c.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  editable={!isSubmitting}
                />
              </View>
              <PressableScale
                style={[
                  styles.submitButton,
                  { backgroundColor: c.accentFill },
                  isSubmitting && styles.submitButtonDisabled,
                ]}
                onPress={handleSendCode}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={c.onAccent} />
                ) : (
                  <Text style={[styles.submitButtonText, { color: c.onAccent }]}>Send code</Text>
                )}
              </PressableScale>
            </>
          )}

          {step === 'code' && (
            <>
              <View style={[styles.inputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <ShieldCheck color={c.textTertiary} size={18} />
                <TextInput
                  style={[styles.input, { color: c.textPrimary, letterSpacing: 4 }]}
                  placeholder="123456"
                  placeholderTextColor={c.textTertiary}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={(text) => setCode(text.replace(/[^0-9]/g, ''))}
                  editable={!isSubmitting}
                />
              </View>
              <PressableScale
                style={[
                  styles.submitButton,
                  { backgroundColor: c.accentFill },
                  isSubmitting && styles.submitButtonDisabled,
                ]}
                onPress={handleVerifyCode}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={c.onAccent} />
                ) : (
                  <Text style={[styles.submitButtonText, { color: c.onAccent }]}>Verify code</Text>
                )}
              </PressableScale>
              <PressableScale onPress={handleResend} disabled={cooldown > 0 || isSubmitting} hitSlop={8}>
                <Text
                  style={[
                    styles.resendText,
                    { color: cooldown > 0 ? c.textTertiary : c.accentInk },
                  ]}
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </PressableScale>
            </>
          )}

          {step === 'password' && (
            <>
              <View style={[styles.inputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <Lock color={c.textTertiary} size={18} />
                <TextInput
                  style={[styles.input, { color: c.textPrimary }]}
                  placeholder="New password"
                  placeholderTextColor={c.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  editable={!isSubmitting}
                />
              </View>
              <View style={[styles.inputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <Lock color={c.textTertiary} size={18} />
                <TextInput
                  style={[styles.input, { color: c.textPrimary }]}
                  placeholder="Confirm new password"
                  placeholderTextColor={c.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  editable={!isSubmitting}
                />
              </View>
              <PressableScale
                style={[
                  styles.submitButton,
                  { backgroundColor: c.accentFill },
                  isSubmitting && styles.submitButtonDisabled,
                ]}
                onPress={handleResetPassword}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={c.onAccent} />
                ) : (
                  <Text style={[styles.submitButtonText, { color: c.onAccent }]}>Reset password</Text>
                )}
              </PressableScale>
            </>
          )}
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
  backButton: {
    position: 'absolute',
    top: 8,
    left: 0,
    padding: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 24,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 10,
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
  resendText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  banner: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: {
    fontSize: 13,
  },
});
