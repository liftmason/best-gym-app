/**
 * The API client: openapi-fetch typed from the backend's openapi.json (`npm run api:types`),
 * with the access token attached and one refresh when it has expired.
 *
 * The refresh happens on a 401, not ahead of the expiry time: a phone's clock can be wrong,
 * and each refresh rotates the refresh token. Requests that hit a 401 together share one
 * refresh. Presenting an old refresh token again after 30 seconds signs the device out
 * (backend apps/signin/services.py), so there must never be two at once.
 *
 * The web app sends `X-Client: web` and its cookie: the server keeps the refresh token in
 * the cookie, and the body's `refresh` is null.
 */
import createClient from 'openapi-fetch';

import { ApiError } from './errors';
import type { paths } from './schema';
import type { Tokens, TokenStore } from './tokens';

export type AuthState = 'loading' | 'signedIn' | 'signedOut';

/** The token part of the API's sign-in answers (TokensOut). */
export type TokensBody = { access: string; refresh?: string | null };

type Options = {
  baseUrl: string;
  store: TokenStore;
  web: boolean;
  fetch?: (request: Request) => Promise<Response>;
};

const REFRESH_PATH = '/api/v1/auth/refresh';

export function makeApi({ baseUrl, store, web, fetch = (r) => globalThis.fetch(r) }: Options) {
  let tokens: Tokens | null = null;
  let state: AuthState = 'loading';
  let refreshing: Promise<Tokens | null> | null = null;
  const listeners = new Set<() => void>();

  function setState(next: AuthState) {
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function keep(next: Tokens | null) {
    tokens = next;
    await store.save(next);
    setState(next ? 'signedIn' : 'signedOut');
  }

  async function post(path: string, body: unknown, access?: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (web) headers['X-Client'] = 'web';
    if (access) headers.Authorization = `Bearer ${access}`;
    try {
      return await fetch(
        new Request(baseUrl + path, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          credentials: web ? 'include' : 'omit',
        }),
      );
    } catch {
      throw ApiError.offline();
    }
  }

  /** New tokens, or null when the refresh token is no good (signed out). Throws when offline. */
  function refresh(): Promise<Tokens | null> {
    refreshing ??= (async () => {
      if (!web && !tokens?.refresh) return null;
      const response = await post(REFRESH_PATH, { refresh: web ? '' : tokens!.refresh });
      if (response.status === 401) {
        await keep(null);
        return null;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) throw ApiError.from(response.status, body);
      await keep(toTokens(body as TokensBody));
      return tokens;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function toTokens(body: TokensBody): Tokens {
    return { access: body.access, refresh: web ? null : (body.refresh ?? null) };
  }

  function authorised(request: Request, access: string | undefined): Request {
    const copy = request.clone();
    if (access) copy.headers.set('Authorization', `Bearer ${access}`);
    return copy;
  }

  async function send(request: Request): Promise<Response> {
    const sentWith = tokens?.access;
    const response = await fetch(authorised(request, sentWith));
    if (response.status !== 401 || !sentWith || request.url.endsWith(REFRESH_PATH)) return response;
    // Another request may already have refreshed while this one was out.
    const fresh = tokens && tokens.access !== sentWith ? tokens : await refresh();
    return fresh ? fetch(authorised(request, fresh.access)) : response;
  }

  const client = createClient<paths>({
    baseUrl,
    fetch: async (request) => {
      try {
        return await send(request);
      } catch (e) {
        throw e instanceof ApiError ? e : ApiError.offline();
      }
    },
    headers: web ? { 'X-Client': 'web' } : {},
    credentials: web ? 'include' : 'omit',
  });

  return {
    client,

    get state() {
      return state;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /**
     * At start-up. A phone is signed in if it has tokens, even offline (the athlete trains
     * offline); the web app asks the server through its cookie. Offline with no answer, the
     * web app shows sign-in.
     */
    async restore() {
      if (!web) {
        const saved = await store.load();
        tokens = saved;
        setState(saved ? 'signedIn' : 'signedOut');
        return;
      }
      try {
        await refresh();
      } catch {
        setState('signedOut');
      }
    },

    /** After a sign-in answer (email/verify, signup/coach, social). */
    signedIn(body: TokensBody) {
      return keep(toTokens(body));
    },

    /** Signs this device out on the server when it can, and here whatever happens. */
    async signOut() {
      const access = tokens?.access;
      if (access) await post('/api/v1/auth/signout', {}, access).catch(() => undefined);
      await keep(null);
    },
  };
}

export type Api = ReturnType<typeof makeApi>;
