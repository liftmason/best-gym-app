import type { SyncStatus } from './engine';
import { statusLabel } from './status';

const base: SyncStatus = { running: false, pending: 0, offline: false, needsUpdate: false, lastSynced: 'x', error: null };

test('the pill says the most useful thing first', () => {
  expect(statusLabel(base)).toEqual({ label: 'Synced', tone: 'good' });
  expect(statusLabel({ ...base, pending: 3 })).toEqual({ label: '3 waiting', tone: 'brand' });
  expect(statusLabel({ ...base, offline: true, pending: 2 })).toEqual({ label: 'Offline · 2 waiting', tone: 'warn' });
  expect(statusLabel({ ...base, offline: true })).toEqual({ label: 'Offline', tone: 'warn' });
  expect(statusLabel({ ...base, needsUpdate: true, offline: true })).toEqual({ label: 'Update the app to sync', tone: 'bad' });
  expect(statusLabel({ ...base, running: true, lastSynced: null })).toEqual({ label: 'Syncing…', tone: 'plain' });
});
