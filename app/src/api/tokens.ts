/**
 * Where the sign-in tokens live. Phones keep both in secure storage. The web app keeps the
 * access token in memory only: its refresh token is an HttpOnly cookie the page can't read,
 * so a reload starts with nothing and refreshes to find out whether it's signed in.
 *
 * The free test run is the exception (docs/plans/S8B_TEST_RUN.md): there the web app and the
 * API are on different sites, the cookie never reaches the API, and the build sets
 * EXPO_PUBLIC_WEB_REMEMBER_SIGN_IN=1 so the web app keeps its (week-long) access token in the
 * browser's storage instead.
 */
import * as SecureStore from 'expo-secure-store';

export type Tokens = {
  access: string;
  /** null on the web: it's in the cookie. */
  refresh: string | null;
};

export type TokenStore = {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens | null): Promise<void>;
};

const KEY = 'gt.tokens';

export const secureStore: TokenStore = {
  async load() {
    const saved = await SecureStore.getItemAsync(KEY);
    if (!saved) return null;
    try {
      const tokens = JSON.parse(saved) as Tokens;
      return typeof tokens.access === 'string' && typeof tokens.refresh === 'string' ? tokens : null;
    } catch {
      return null;
    }
  },
  async save(tokens) {
    if (tokens) await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
    else await SecureStore.deleteItemAsync(KEY);
  },
};

/** The web app's store: nothing survives a reload. */
export const memoryStore: TokenStore = {
  load: async () => null,
  save: async () => {},
};

const WEB_KEY = 'gt.web-access';

/** The test run's web store: the access token only, in localStorage. Blocked storage (a
 * private window, cleared site data) just means signing in again. */
export const browserStore: TokenStore = {
  async load() {
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(WEB_KEY) ?? 'null') as { access?: unknown } | null;
      return typeof saved?.access === 'string' ? { access: saved.access, refresh: null } : null;
    } catch {
      return null;
    }
  },
  async save(tokens) {
    try {
      if (tokens) globalThis.localStorage?.setItem(WEB_KEY, JSON.stringify({ access: tokens.access }));
      else globalThis.localStorage?.removeItem(WEB_KEY);
    } catch {
      // Nothing to do: the next reload signs in again.
    }
  },
};

/** The web app's store, from the build's EXPO_PUBLIC_WEB_REMEMBER_SIGN_IN. */
export function webTokenStore(remember: string | undefined): TokenStore {
  return remember === '1' ? browserStore : memoryStore;
}
