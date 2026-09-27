import { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { pushAvailable, registerForPush } from './register';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  AndroidImportance: { HIGH: 4 },
}));

const mockNotifications = jest.mocked(Notifications);

function fakeApi() {
  const PUT = jest.fn(async () => ({ data: undefined, response: new Response(null, { status: 204 }) }));
  return { api: { client: { PUT } } as never, PUT };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' } as never);
});

test('push needs a real phone in our own build', () => {
  expect(pushAvailable('android', true, ExecutionEnvironment.Standalone)).toBe(true);
  expect(pushAvailable('ios', true, ExecutionEnvironment.StoreClient)).toBe(true);
  expect(pushAvailable('android', true, ExecutionEnvironment.StoreClient)).toBe(false); // Expo Go
  expect(pushAvailable('web', false, ExecutionEnvironment.Bare)).toBe(false);
  expect(pushAvailable('ios', false, ExecutionEnvironment.Bare)).toBe(false); // a simulator
});

test('with permission, the token goes to the server for this device', async () => {
  mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  const { api, PUT } = fakeApi();
  expect(await registerForPush(api, true)).toBe('registered');
  expect(PUT).toHaveBeenCalledWith('/api/v1/auth/push-token', { body: { token: 'ExponentPushToken[abc]' } });
});

test('refused permission or no push: nothing is sent', async () => {
  mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
  const { api, PUT } = fakeApi();
  expect(await registerForPush(api, true)).toBe('refused');
  expect(await registerForPush(api, false)).toBe('unavailable');
  expect(PUT).not.toHaveBeenCalled();
});
