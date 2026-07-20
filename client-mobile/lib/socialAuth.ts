// client-mobile/lib/socialAuth.ts
// Sign in with Google/Apple: the native SDK gets an ID token on-device
// (the mobile app is the OAuth client), then we hand that token to the
// backend for verification + get-or-create (core/social_auth.py). Uses
// a bare axios.post rather than the shared `api` instance, matching
// login.tsx/register.tsx's existing convention for pre-authentication
// calls — there's no token yet for `api`'s request interceptor to attach.
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import axios from 'axios';

import { API_BASE_URL } from './api';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

export interface SocialAuthProfile {
  id: number;
  username: string;
  email: string;
  profile_picture: string | null;
  total_time_watched: number;
  watched_days: number;
  watched_hours: number;
  watched_minutes: number;
  earned_badges: string[];
  created_at: string;
}

export interface SocialAuthResponse {
  access: string;
  refresh: string;
  profile: SocialAuthProfile;
  created: boolean;
}

export async function signInWithGoogle(): Promise<SocialAuthResponse | null> {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo.data?.idToken;
    if (!idToken) {
      throw new Error('Google did not return an ID token.');
    }
    const response = await axios.post<SocialAuthResponse>(`${API_BASE_URL}/auth/google/`, {
      id_token: idToken,
    });
    return response.data;
  } catch (err: any) {
    if (err?.code === statusCodes.SIGN_IN_CANCELLED) {
      return null; // user backed out — not an error
    }
    throw err;
  }
}

export async function signInWithApple(): Promise<SocialAuthResponse | null> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    const response = await axios.post<SocialAuthResponse>(`${API_BASE_URL}/auth/apple/`, {
      id_token: credential.identityToken,
      first_name: credential.fullName?.givenName ?? '',
      last_name: credential.fullName?.familyName ?? '',
    });
    return response.data;
  } catch (err: any) {
    if (err?.code === 'ERR_REQUEST_CANCELED') {
      return null; // user dismissed the native sheet — not an error
    }
    throw err;
  }
}
