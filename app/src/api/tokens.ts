/**
 * Where the sign-in tokens live. Phones keep both in secure storage. The web app keeps the
 * access token in memory only: its refresh token is an HttpOnly cookie the page can't read,
 * so a reload starts with nothing and refreshes to find out whether it's signed in.
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
