/**
 * Coaching or Training. One account can have a coach profile, an athlete profile, or both;
 * with both, the app opens in the mode last used (coaching the first time).
 */
import type { components } from '@/api';

import { getPref, setPref } from './prefs';

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
  const saved = await getPref(KEY);
  return saved === 'coaching' || saved === 'training' ? saved : null;
}

export function rememberMode(mode: Mode): Promise<void> {
  return setPref(KEY, mode);
}
