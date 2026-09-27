import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ApiError } from '@/api';
import { useMe } from '@/auth/me';
import { lastAthlete, rememberAthlete } from '@/auth/mode';
import type { Who } from '@/sync/engine';
import { SyncProvider } from '@/sync/provider';
import { colors } from '@/ui';

/**
 * Training mode: offline-first, on the device's own copy kept in step by sync. Opened with no
 * connection, it runs as the athlete this device last synced for.
 */
export default function TrainingLayout() {
  const me = useMe();
  const [saved, setSaved] = useState<Who | null | undefined>(undefined);
  const athleteId = me.data?.athlete?.id;
  const userId = me.data?.id;

  useEffect(() => {
    lastAthlete().then(setSaved);
  }, []);
  useEffect(() => {
    if (athleteId && userId) rememberAthlete({ athleteId, userId });
  }, [athleteId, userId]);

  const offline = me.error instanceof ApiError && me.error.offline;
  const who = athleteId && userId ? { athleteId, userId } : offline ? saved : null;

  if (!who && (me.isPending || saved === undefined)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!who) return <Redirect href="/" />;
  return (
    <SyncProvider who={who}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </SyncProvider>
  );
}
