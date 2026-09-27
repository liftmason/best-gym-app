/**
 * The app's API: `api.client.GET('/api/v1/me')` with `ok(...)` to get the data or an ApiError.
 * `useAuth()` is the sign-in state for screens.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { makeApi } from './client';
import { apiBaseUrl } from './config';
import { memoryStore, secureStore } from './tokens';

export { ApiError, ok } from './errors';
export { makeQueryClient } from './query';
export type { AuthState } from './client';
export type { components, paths } from './schema';

const web = Platform.OS === 'web';

export const api = makeApi({ baseUrl: apiBaseUrl(), store: web ? memoryStore : secureStore, web });

export function useAuth() {
  return useSyncExternalStore(api.subscribe, () => api.state);
}
