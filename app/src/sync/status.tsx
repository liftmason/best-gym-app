/** How sync stands (synced, N waiting, offline), and a short notice when the server refuses something. */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, colors, radius, space, Text } from '@/ui';

import type { Notice, SyncStatus } from './engine';
import { useSync, useSyncStatus } from './provider';

export function statusLabel(status: SyncStatus): { label: string; tone: 'good' | 'brand' | 'warn' | 'bad' | 'plain' } {
  const waiting = status.pending ? `${status.pending} waiting` : '';
  if (status.needsUpdate) return { label: 'Update the app to sync', tone: 'bad' };
  if (status.offline) return { label: waiting ? `Offline · ${waiting}` : 'Offline', tone: 'warn' };
  if (waiting) return { label: waiting, tone: 'brand' };
  if (status.running && !status.lastSynced) return { label: 'Syncing…', tone: 'plain' };
  if (status.error) return { label: "Couldn't sync", tone: 'warn' };
  return { label: 'Synced', tone: 'good' };
}

export function SyncPill() {
  const { label, tone } = statusLabel(useSyncStatus());
  return (
    <View accessibilityRole="text" accessibilityLabel={`Sync: ${label}`}>
      <Chip label={label} tone={tone} />
    </View>
  );
}

export const NOTICE_MS = 6000;

/** The latest refused action, for a few seconds. */
export function SyncNotices() {
  const { engine } = useSync();
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = engine.onNotice((next) => {
      setNotice(next);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), NOTICE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [engine]);

  if (!notice) return null;
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Text variant="small" tone="bad">
        Not saved: {notice.message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    margin: space.l,
    padding: space.m,
    borderRadius: radius.m,
    backgroundColor: colors.badLight,
  },
});
