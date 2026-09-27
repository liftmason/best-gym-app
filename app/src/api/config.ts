/**
 * Where the API is. `EXPO_PUBLIC_API_URL` wins (set it for a deployed backend). Otherwise, in
 * development: the web app uses localhost, and a phone in Expo Go uses the address it loaded
 * the app from (the dev machine), on the backend's port.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEV_PORT = 8000;

export function apiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (Platform.OS === 'web') return `http://localhost:${DEV_PORT}`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:${DEV_PORT}`;
}
