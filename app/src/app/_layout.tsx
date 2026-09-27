import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { api, makeQueryClient, useAuth } from '@/api';
import { colors } from '@/ui';

SplashScreen.preventAutoHideAsync();

const queryClient = makeQueryClient();

/**
 * The app's root: signing in, the athlete's training (offline-first) and coaching (online).
 * The splash stays up until the fonts are in and the saved session is read. Signed-in routes
 * and sign-in are guarded; an invite link opens either way.
 */
export default function RootLayout() {
  const [loaded, failed] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const auth = useAuth();
  const ready = (loaded || failed) && auth !== 'loading';

  useEffect(() => {
    api.restore();
    // Nothing from one account may show for the next.
    return api.subscribe(() => {
      if (api.state === 'signedOut') queryClient.clear();
    });
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={auth === 'signedIn'}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(training)" />
          <Stack.Screen name="(coaching)" />
        </Stack.Protected>
        <Stack.Protected guard={auth === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="join/[token]" />
        <Stack.Screen name="kit" />
      </Stack>
    </QueryClientProvider>
  );
}
