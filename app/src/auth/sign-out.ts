/**
 * Signing out. Training done offline and not yet sent would be lost, so that asks first.
 * The device's copy of the athlete's data goes too.
 */
import { api } from '@/api';
import { forgetDevice, unsentActions } from '@/sync/session';
import { saveProfile } from '@/training/profile';
import { confirm } from '@/ui/confirm';

export async function signOut(): Promise<void> {
  const unsent = await unsentActions().catch(() => 0);
  if (unsent) {
    const things = unsent === 1 ? '1 change' : `${unsent} changes`;
    const sure = await confirm(
      `${things[0].toUpperCase()}${things.slice(1)} not sent yet`,
      `Signing out now loses ${things} made on this device. Connect to the internet first to keep ${unsent === 1 ? 'it' : 'them'}.`,
      'Sign out anyway',
    );
    if (!sure) return;
  }
  await signOutNow();
}

/** Sign out without asking (after deleting the account, when nothing is left to keep). */
export async function signOutNow(): Promise<void> {
  await forgetDevice().catch(() => {});
  await saveProfile(null);
  await api.signOut();
}
