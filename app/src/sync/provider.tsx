/**
 * Training mode's sync: opens the device's database, runs the engine on its schedule, and
 * gives screens the database, the engine and its status.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { OtherTab } from '@/db/tab-lock';
import { Button, colors, space, Text } from '@/ui';

import type { TrainingProfile } from '@/training/profile';

import type { SyncStatus } from './engine';
import { startScheduler } from './scheduler';
import { startSession, type SyncSession } from './session';
import { surroundings } from './surroundings';

const Context = createContext<(SyncSession & { profile: TrainingProfile }) | null>(null);

export function SyncProvider({ profile, children }: { profile: TrainingProfile; children: ReactNode }) {
  const [session, setSession] = useState<SyncSession | null>(null);
  const [failed, setFailed] = useState<'other-tab' | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { athleteId, userId, timezone, maxUpdates } = profile;

  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    startSession({ athleteId, userId, timezone, maxUpdates })
      .then((started) => {
        if (!alive) return;
        setSession(started);
        stop = startScheduler(started.engine, surroundings);
      })
      .catch((error) => alive && setFailed(error instanceof OtherTab ? 'other-tab' : 'error'));
    return () => {
      alive = false;
      stop?.();
    };
  }, [athleteId, userId, timezone, maxUpdates, attempt]);

  if (failed) {
    return (
      <View style={styles.centre}>
        {failed === 'other-tab' ? (
          <>
            <Text variant="h3">GymTrainer is open in another tab</Text>
            <Text tone="muted">Your training can be open in one tab at a time. Close the other one, then try again here.</Text>
          </>
        ) : (
          <>
            <Text variant="h3">Couldn&apos;t open your training on this device</Text>
            <Text tone="muted">Try again. If it keeps happening, restart the app.</Text>
          </>
        )}
        <Button
          title="Try again"
          onPress={() => {
            setFailed(null);
            setAttempt((n) => n + 1);
          }}
        />
      </View>
    );
  }
  if (!session) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  return <Context.Provider value={{ ...session, profile }}>{children}</Context.Provider>;
}

export function useSync(): SyncSession & { profile: TrainingProfile } {
  const session = useContext(Context);
  if (!session) throw new Error('useSync outside SyncProvider');
  return session;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useSync();
  return useSyncExternalStore(engine.subscribe, () => engine.status);
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, padding: space.xl },
});
