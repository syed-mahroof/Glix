import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// expo-notifications uses import.meta which crashes the web bundler.
// Also skip on Expo Go (SDK 53+ removed remote push support).
const isExpoGo = Constants.appOwnership === 'expo';
const isWeb = Platform.OS === 'web';

let Notifications: any = null;

if (!isExpoGo && !isWeb) {
  try {
    Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (e) {
    console.log('Could not require expo-notifications', e);
  }
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (isExpoGo || !Notifications) {
    console.log('Push notifications are not supported in Expo Go on SDK 53+. Use a development build.');
    return null;
  }

  let token = null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E4FA1A',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }
    
    try {
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (e) {
      console.log('Failed to get push token:', e);
    }
  }

  return token;
}
