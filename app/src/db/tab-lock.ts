/**
 * On the web only one tab can open the local database (the browser gives its file to one
 * tab). The tab that opens it holds a Web Lock for as long as it lives; another tab finds
 * the lock taken and says so, rather than failing somewhere inside SQLite.
 */
import { APP_NAME } from '@/name';

type Locks = {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
};

export const LOCK = 'gymtrainer-database';

export class OtherTab extends Error {
  constructor() {
    super(`${APP_NAME} is open in another tab.`);
    this.name = 'OtherTab';
  }
}

let holding: Promise<boolean> | null = null;

/** True once this tab holds the lock (or the browser has no Web Locks: SQLite then decides). */
export async function holdTabLock(
  locks: Locks | undefined = (globalThis.navigator as { locks?: Locks } | undefined)?.locks,
): Promise<boolean> {
  if (!locks) return true;
  holding ??= new Promise((resolve) => {
    void locks.request(LOCK, { ifAvailable: true }, (lock) => {
      resolve(Boolean(lock));
      return lock ? new Promise(() => {}) : Promise.resolve(); // kept until the tab closes
    });
  });
  const held = await holding;
  if (!held) holding = null; // try again later
  return held;
}
