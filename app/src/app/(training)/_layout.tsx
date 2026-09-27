import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { SyncProvider } from '@/sync/provider';
import { useTrainingProfile } from '@/training/profile';
import { colors } from '@/ui';

/**
 * Training mode: offline-first, on the device's own copy kept in step by sync. Opened with no
 * connection, it runs on the profile saved at the last sign-in (S5 decision D).
 */
export default function TrainingLayout() {
  const profile = useTrainingProfile();
  if (profile === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!profile) return <Redirect href="/" />;
  return (
    <SyncProvider profile={profile}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </SyncProvider>
  );
}
