import { makeApi } from './client';
import { ApiError, ok } from './errors';
import type { Tokens, TokenStore } from './tokens';

const BASE = 'http://api.test';

/** A fake backend: one valid access token and one valid refresh token, rotated on refresh. */
function server() {
  const state = { access: 'a1', refresh: 'r1', n: 1, refreshes: 0, seen: [] as Request[] };
  const json = (status: number, body: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const notSignedIn = () => json(401, { error: { code: 'not_signed_in', message: 'Sign in again.', fields: {} } });

  async function fetch(request: Request): Promise<Response> {
    state.seen.push(request);
    const path = new URL(request.url).pathname;
    if (path === '/api/v1/auth/refresh') {
      state.refreshes += 1;
      const { refresh } = (await request.json()) as { refresh: string };
      const web = request.headers.get('X-Client') === 'web';
      if (!web && refresh !== state.refresh) return notSignedIn();
      state.n += 1;
      state.access = `a${state.n}`;
      state.refresh = `r${state.n}`;
      return json(200, { access: state.access, refresh: web ? null : state.refresh });
    }
    if (request.headers.get('Authorization') !== `Bearer ${state.access}`) return notSignedIn();
    if (path === '/api/v1/me') return json(200, { name: 'Dana' });
    if (path === '/api/v1/auth/signout') return json(204, undefined);
    return json(404, { error: { code: 'not_found', message: 'Not found.', fields: {} } });
  }

  return { state, fetch: jest.fn(fetch) };
}

function memory(initial: Tokens | null = null): TokenStore & { saved: Tokens | null } {
  const store = {
    saved: initial,
    load: async () => store.saved,
    save: async (tokens: Tokens | null) => {
      store.saved = tokens;
    },
  };
  return store;
}

async function phone(tokens: Tokens | null, fake = server()) {
  const store = memory(tokens);
  const api = makeApi({ baseUrl: BASE, store, web: false, fetch: fake.fetch });
  await api.restore();
  return { api, store, fake };
}

test('a phone with saved tokens is signed in and sends its access token', async () => {
  const { api, fake } = await phone({ access: 'a1', refresh: 'r1' });
  expect(api.state).toBe('signedIn');
  expect(await ok(api.client.GET('/api/v1/me'))).toMatchObject({ name: 'Dana' });
  expect(fake.state.seen[0].headers.get('Authorization')).toBe('Bearer a1');
  expect(fake.state.seen[0].headers.get('X-Client')).toBeNull();
});

test('an expired access token is refreshed once and the request retried', async () => {
  const fake = server();
  fake.state.access = 'a-new-one'; // the phone's a1 has expired
  const { api, store } = await phone({ access: 'a1', refresh: 'r1' }, fake);
  await ok(api.client.GET('/api/v1/me'));
  expect(fake.state.refreshes).toBe(1);
  expect(store.saved).toEqual({ access: 'a2', refresh: 'r2' });
});

test('requests that expire together share one refresh', async () => {
  const fake = server();
  fake.state.access = 'expired-everywhere';
  const { api } = await phone({ access: 'a1', refresh: 'r1' }, fake);
  const all = await Promise.all([1, 2, 3, 4].map(() => ok(api.client.GET('/api/v1/me'))));
  expect(all).toHaveLength(4);
  expect(fake.state.refreshes).toBe(1); // a second refresh would present r1 again
});

test('a refresh token that is no good signs the phone out', async () => {
  const fake = server();
  fake.state.access = 'a9';
  fake.state.refresh = 'r9'; // signed out from another device
  const { api, store } = await phone({ access: 'a1', refresh: 'r1' }, fake);
  const heard = jest.fn();
  api.subscribe(heard);
  await expect(ok(api.client.GET('/api/v1/me'))).rejects.toMatchObject({ status: 401, code: 'not_signed_in' });
  expect(api.state).toBe('signedOut');
  expect(heard).toHaveBeenCalled();
  expect(store.saved).toBeNull();
});

test('no connection is an offline error, and the phone stays signed in', async () => {
  const store = memory({ access: 'a1', refresh: 'r1' });
  const api = makeApi({
    baseUrl: BASE,
    store,
    web: false,
    fetch: () => Promise.reject(new TypeError('Network request failed')),
  });
  await api.restore();
  const error: ApiError = await ok(api.client.GET('/api/v1/me')).catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.offline).toBe(true);
  expect(api.state).toBe('signedIn');
});

test("the API's errors keep their code, message and fields", async () => {
  const { api } = await phone({ access: 'a1', refresh: 'r1' });
  const error: ApiError = await ok(api.client.GET('/api/v1/athletes/{athlete_id}', {
    params: { path: { athlete_id: 'x' } },
  } as never)).catch((e) => e);
  expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Not found.', fields: {} });
});

test('the web app finds its session through the cookie and keeps nothing', async () => {
  const fake = server();
  const store = memory();
  const api = makeApi({ baseUrl: BASE, store, web: true, fetch: fake.fetch });
  await api.restore();
  expect(api.state).toBe('signedIn');
  const [refresh] = fake.state.seen;
  expect(refresh.headers.get('X-Client')).toBe('web');
  expect(refresh.credentials).toBe('include');
  await ok(api.client.GET('/api/v1/me'));
  const me = fake.state.seen[1];
  expect(me.headers.get('X-Client')).toBe('web');
  expect(me.headers.get('Authorization')).toBe('Bearer a2');
  expect(store.saved).toEqual({ access: 'a2', refresh: null });
});

test('a web app that remembers its access token is signed in without asking the server', async () => {
  // The free test run: the app and the API are on different sites, so the refresh cookie
  // can't reach the API and the web app keeps the access token instead.
  const fake = server();
  const api = makeApi({ baseUrl: BASE, store: memory({ access: 'a1', refresh: null }), web: true, fetch: fake.fetch });
  await api.restore();
  expect(api.state).toBe('signedIn');
  expect(fake.state.refreshes).toBe(0);
  await ok(api.client.GET('/api/v1/me'));
  expect(fake.state.seen[0].headers.get('Authorization')).toBe('Bearer a1');
});

test('a remembered access token the server refuses falls back to the cookie', async () => {
  const fake = server();
  const store = memory({ access: 'expired', refresh: null });
  const api = makeApi({ baseUrl: BASE, store, web: true, fetch: fake.fetch });
  await api.restore();
  expect(await ok(api.client.GET('/api/v1/me'))).toMatchObject({ name: 'Dana' });
  expect(fake.state.refreshes).toBe(1);
  expect(store.saved).toEqual({ access: 'a2', refresh: null });
});

/** A server that's asleep for the first `failures` requests (Render's free tier waking up). */
function sleepy(failures: number, fake = server()) {
  let left = failures;
  return {
    fake,
    fetch: jest.fn(async (request: Request) => {
      if (left > 0) {
        left -= 1;
        throw new TypeError('Failed to fetch');
      }
      return fake.fetch(request);
    }),
  };
}

test('the web app waits for a sleeping server to wake, saying so meanwhile', async () => {
  const { fetch } = sleepy(3);
  const waits: number[] = [];
  const seen: boolean[] = [];
  const api = makeApi({
    baseUrl: BASE,
    store: memory({ access: 'a1', refresh: null }),
    web: true,
    fetch,
    wait: async (ms) => {
      waits.push(ms);
      seen.push(api.waking);
    },
    online: () => true,
  });
  await api.restore();
  expect(await ok(api.client.GET('/api/v1/me'))).toMatchObject({ name: 'Dana' });
  expect(waits.length).toBe(3);
  expect(seen).toEqual([true, true, true]);
  expect(api.waking).toBe(false);
});

test('the web app gives up after about a minute and a half', async () => {
  const { fetch } = sleepy(1000);
  let waited = 0;
  const api = makeApi({
    baseUrl: BASE,
    store: memory({ access: 'a1', refresh: null }),
    web: true,
    fetch,
    wait: async (ms) => {
      waited += ms;
    },
    online: () => true,
  });
  await api.restore();
  const error: ApiError = await ok(api.client.GET('/api/v1/me')).catch((e) => e);
  expect(error.offline).toBe(true);
  expect(waited).toBeGreaterThanOrEqual(60_000);
  expect(waited).toBeLessThanOrEqual(90_000);
  expect(api.waking).toBe(false);
});

test("no waiting when the browser knows it's offline, or on a phone", async () => {
  for (const [web, online] of [[true, false], [false, true]] as const) {
    const { fetch } = sleepy(1);
    const wait = jest.fn(async () => {});
    const api = makeApi({ baseUrl: BASE, store: memory({ access: 'a1', refresh: 'r1' }), web, fetch, wait, online: () => online });
    await api.restore();
    const error: ApiError = await ok(api.client.GET('/api/v1/me')).catch((e) => e);
    expect(error.offline).toBe(true);
    expect(wait).not.toHaveBeenCalled();
  }
});

test('signing in on a waking server waits too (the refresh at start-up)', async () => {
  const { fetch } = sleepy(2);
  const api = makeApi({ baseUrl: BASE, store: memory(), web: true, fetch, wait: async () => {}, online: () => true });
  await api.restore();
  expect(api.state).toBe('signedIn');
});

test('signing in keeps the tokens; signing out forgets them even offline', async () => {
  const { api, store, fake } = await phone(null);
  expect(api.state).toBe('signedOut');
  await api.signedIn({ access: 'a1', refresh: 'r1' });
  expect(api.state).toBe('signedIn');
  expect(store.saved).toEqual({ access: 'a1', refresh: 'r1' });
  fake.fetch.mockRejectedValue(new TypeError('Network request failed'));
  await api.signOut();
  expect(api.state).toBe('signedOut');
  expect(store.saved).toBeNull();
});
