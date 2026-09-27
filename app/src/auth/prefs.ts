/**
 * Small things the app remembers between runs (the last mode, whose training is on this
 * device): secure storage on phones, localStorage on the web. Only conveniences: a failure
 * reads as nothing saved.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const web = Platform.OS === 'web';

export async function getPref(key: string): Promise<string | null> {
  try {
    return web ? (globalThis.localStorage?.getItem(key) ?? null) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setPref(key: string, value: string | null): Promise<void> {
  try {
    if (web) {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } else if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // A convenience only.
  }
}
