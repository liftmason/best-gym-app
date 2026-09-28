import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useMe } from '@/auth/me';
import { colors, ToastProvider } from '@/ui';

/** Coaching mode: online, through the API (the design keeps coaches online). */
export default function CoachingLayout() {
  const me = useMe();
  if (me.isPending) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!me.data?.coach) return <Redirect href="/" />;
  return (
    <ToastProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </ToastProvider>
  );
}
