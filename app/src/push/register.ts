/**
 * Push notifications on this device (backend apps/signin/push.py). Once signed in, the app
 * asks permission, gets the device's Expo push token and gives it to the server, which ties
 * it to this device's session. Push needs a development build: Expo Go on Android has none
 * (SDK 53 on) and the web has none, so there it quietly does nothing.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Api } from '@/api/client';
import { ok } from '@/api/errors';
import { APP_NAME } from '@/name';

export type Registered = 'registered' | 'unavailable' | 'refused';

export const CHANNEL = 'default';

/** Where push can work: a real phone, in a build of our own (not Expo Go on Android). */
export function pushAvailable(
  os: string = Platform.OS,
  isDevice: boolean = Device.isDevice,
  environment: string = Constants.executionEnvironment,
): boolean {
  if (os === 'web' || !isDevice) return false;
  return !(os === 'android' && environment === ExecutionEnvironment.StoreClient);
}

export async function registerForPush(api: Api, available = pushAvailable()): Promise<Registered> {
  if (!available) return 'unavailable';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: APP_NAME,
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return 'refused';
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await ok(api.client.PUT('/api/v1/auth/push-token', { body: { token } }));
  return 'registered';
}

export type PushData = { type?: string; athlete_id?: string; sync?: boolean };

/**
 * Shown while the app is open, too; every push also asks for a sync. A tap (also one that
 * opened the app) goes to what it's about.
 */
export function handlePushes(onSync: () => void, onOpen: (data: PushData) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  const wantsSync = (data: unknown) => Boolean((data as { sync?: unknown } | undefined)?.sync);
  const received = Notifications.addNotificationReceivedListener((n) => {
    if (wantsSync(n.request.content.data)) onSync();
  });
  const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
    const data = (r.notification.request.content.data ?? {}) as PushData;
    if (wantsSync(data)) onSync();
    onOpen(data);
  });
  Notifications.getLastNotificationResponseAsync()
    .then((r) => r && onOpen((r.notification.request.content.data ?? {}) as PushData))
    .catch(() => {});
  return () => {
    received.remove();
    tapped.remove();
  };
}

/**
 * Where a tapped push goes. The athlete's: their messages or week. A coach's (it names the
 * athlete): that athlete, on messages for a message, else their sessions (an issue, a video).
 */
export function pushTarget(data: PushData): string {
  if (data.athlete_id) return `/athletes/${data.athlete_id}?tab=${data.type === 'message' ? 'messages' : 'sessions'}`;
  if (data.type === 'message') return '/messages';
  if (data.type === 'week') return '/home';
  return '/';
}
