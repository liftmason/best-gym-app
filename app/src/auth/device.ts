/** What this device is called in the account's device list ("Pixel 8", "Web browser"). */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export function deviceLabel(): string {
  if (Platform.OS === 'web') return 'Web browser';
  return Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
}

/** The device's time zone, for a new account ("" lets the server choose). */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}
