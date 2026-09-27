/**
 * When to sync (S4 plan): on opening, a few seconds after each action, when the network
 * comes back, when the app returns to the foreground, and every 60 seconds while it's open.
 */
import type { SyncEngine } from './engine';

export const AFTER_ACTION_MS = 3000;
export const EVERY_MS = 60_000;

/** The app's surroundings, passed in so tests can play them. */
export type Surroundings = {
  /** Calls back with true when the app comes to the foreground, false when it leaves. */
  onForeground(listener: (active: boolean) => void): () => void;
  /** Calls back with true when a connection appears, false when it goes. */
  onNetwork(listener: (connected: boolean) => void): () => void;
};

export function startScheduler(engine: Pick<SyncEngine, 'sync' | 'onQueued'>, around: Surroundings): () => void {
  let active = true;
  let soon: ReturnType<typeof setTimeout> | null = null;
  const sync = () => void engine.sync();

  sync();
  const every = setInterval(() => active && sync(), EVERY_MS);
  const stopQueued = engine.onQueued(() => {
    if (soon) clearTimeout(soon);
    soon = setTimeout(() => {
      soon = null;
      sync();
    }, AFTER_ACTION_MS);
  });
  const stopForeground = around.onForeground((now) => {
    if (now && !active) sync();
    active = now;
  });
  let connected = true;
  const stopNetwork = around.onNetwork((now) => {
    if (now && !connected) sync();
    connected = now;
  });

  return () => {
    clearInterval(every);
    if (soon) clearTimeout(soon);
    stopQueued();
    stopForeground();
    stopNetwork();
  };
}
