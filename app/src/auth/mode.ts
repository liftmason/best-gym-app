/**
 * Coaching or Training. One account can have a coach profile, an athlete profile, or both;
 * with both, the app opens in the mode last used (coaching the first time).
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { components } from '@/api';

export type Mode = 'coaching' | 'training';
type Me = components['schemas']['MeOut'];

/** Each mode's first screen. */
export const HOME: Record<Mode, '/home' | '/dashboard'> = { training: '/home', coaching: '/dashboard' };

export function modeFor(me: Pick<Me, 'coach' | 'athlete'>, last: Mode | null): Mode | null {
  if (me.coach && me.athlete) return last ?? 'coaching';
  if (me.coach) return 'coaching';
  if (me.athlete) return 'training';
  return null;
}

const KEY = 'gt.mode';

export async function lastMode(): Promise<Mode | null> {
  try {
    const saved = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return saved === 'coaching' || saved === 'training' ? saved : null;
  } catch {
    return null;
  }
}

export async function rememberMode(mode: Mode): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, mode);
    else await SecureStore.setItemAsync(KEY, mode);
  } catch {
    // Only a convenience: the next start opens in coaching mode.
  }
}
