import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';

import { api, makeQueryClient, useAuth } from '@/api';
import { handlePushes, pushTarget, registerForPush } from '@/push/register';
import { syncNow } from '@/sync/session';
import { colors } from '@/ui';
import { withReporting } from '@/errors/reporting';

SplashScreen.preventAutoHideAsync();

const queryClient = makeQueryClient();

/**
 * The app's root: signing in, the athlete's training (offline-first) and coaching (online).
 * The splash stays up until the fonts are in and the saved session is read. Signed-in routes
 * and sign-in are guarded; invite links, the delete-account page and the legal pages open either way.
 */
function RootLayout() {
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

  // A tapped push can come before the app is ready (it opened the app): go there once it is.
  const canGo = Boolean(ready) && auth === 'signedIn';
  const canGoNow = useRef(false);
  const tapped = useRef<ReturnType<typeof pushTarget> | null>(null);
  useEffect(
    () =>
      handlePushes(syncNow, (data) => {
        if (canGoNow.current) router.navigate(pushTarget(data) as Href);
        else tapped.current = pushTarget(data);
      }),
    [],
  );
  useEffect(() => {
    canGoNow.current = canGo;
    if (canGo && tapped.current) {
      router.navigate(tapped.current as Href);
      tapped.current = null;
    }
  }, [canGo]);
  useEffect(() => {
    // Each sign-in is a new device session on the server, so the token is given again.
    if (auth === 'signedIn') registerForPush(api).catch(() => {});
  }, [auth]);

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
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="terms" />
        <Stack.Screen name="kit" />
      </Stack>
    </QueryClientProvider>
  );
}

export default withReporting(RootLayout);
