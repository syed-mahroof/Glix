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

// GoogleSignin only documents 4 status codes (SIGN_IN_CANCELLED,
// IN_PROGRESS, PLAY_SERVICES_NOT_AVAILABLE, SIGN_IN_REQUIRED) — anything
// else (most notably native code 10 / "DEVELOPER_ERROR", the classic
// symptom of the app's release signing certificate's SHA-1 not being
// registered against the Android OAuth client in Google Cloud Console)
// used to fall through as a bare native error with no `.message` handling,
// then get discarded entirely by extractErrorMessage's old catch-all
// (fixed separately in lib/errors.ts) — so a real, diagnosable failure
// always displayed as "An unexpected error occurred." with no way to tell
// misconfigured credentials apart from a flaky network. Map the known
// codes to plain language and let the rest through with the native code
// attached so it's at least reportable/debuggable instead of opaque.
function describeGoogleSignInError(err: any): Error {
  switch (err?.code) {
    case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
      return new Error('Google Play Services is unavailable or out of date on this device.');
    case statusCodes.IN_PROGRESS:
      return new Error('A Google sign-in is already in progress.');
    case statusCodes.SIGN_IN_REQUIRED:
      return new Error('Please sign in with Google again.');
    default:
      return new Error(
        `Google sign-in failed (${err?.code ?? err?.message ?? 'unknown error'}). ` +
          'If this keeps happening, the app’s Google sign-in credentials may need reconfiguring.'
      );
  }
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
    if (axios.isAxiosError(err)) {
      throw err; // let extractErrorMessage's axios branch handle backend errors
    }
    throw describeGoogleSignInError(err);
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
