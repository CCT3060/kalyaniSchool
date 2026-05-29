/**
 * notifications.js
 * ----------------
 * Utilities for Expo Push Notifications:
 *  - Configuring foreground notification display behaviour
 *  - Requesting OS push-notification permission
 *  - Obtaining and registering the Expo Push Token
 *  - Persisting the token on the backend
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from './api';

// ── Foreground notification display ──────────────────────────────────────────
// Show banner + play sound even when the app is already open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Requests push-notification permission and obtains an Expo Push Token.
 * Saves the token to the backend against the parent's email address.
 *
 * @param {string} parentEmail - The logged-in parent's email address
 * @returns {Promise<string|null>} The push token string, or null when
 *   unavailable (emulator, permission denied, or network error).
 */
export async function registerForPushNotificationsAsync(parentEmail) {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    return null;
  }

  // Create the default Android notification channel (required for Android 8+)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Tap-N-Eat Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10B981',
      sound: 'default',
    });
  }

  // Check existing permission status
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permission only if not yet decided
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  // User denied or restricted — nothing more to do
  if (finalStatus !== 'granted') {
    return null;
  }

  // Retrieve the Expo Push Token using the EAS project ID from app config
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenData.data;

    // Persist token on the backend so the server can reach this device
    if (token && parentEmail) {
      await saveTokenToBackend(parentEmail, token);
    }

    return token;
  } catch (err) {
    console.error('[Notifications] Failed to get push token:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * POSTs the Expo Push Token to the backend.
 * Errors are swallowed so a failed save never breaks the UI.
 *
 * @param {string} parentEmail
 * @param {string} pushToken
 */
async function saveTokenToBackend(parentEmail, pushToken) {
  try {
    await api('push-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: parentEmail, push_token: pushToken }),
    });
  } catch (err) {
    console.error('[Notifications] Failed to save push token to backend:', err);
  }
}
