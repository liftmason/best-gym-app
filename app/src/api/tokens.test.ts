import { browserStore, memoryStore, webTokenStore } from './tokens';

function fakeLocalStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

function useStorage(storage: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

test('the browser store keeps the access token across a reload, and forgets it on sign-out', async () => {
  useStorage(fakeLocalStorage());
  await browserStore.save({ access: 'a1', refresh: null });
  expect(await browserStore.load()).toEqual({ access: 'a1', refresh: null });
  await browserStore.save(null);
  expect(await browserStore.load()).toBeNull();
});

test('the browser store never keeps a refresh token', async () => {
  useStorage(fakeLocalStorage());
  await browserStore.save({ access: 'a1', refresh: 'r1' });
  expect(await browserStore.load()).toEqual({ access: 'a1', refresh: null });
});

test('blocked or broken storage just means signing in again', async () => {
  useStorage({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  });
  await expect(browserStore.save({ access: 'a1', refresh: null })).resolves.toBeUndefined();
  expect(await browserStore.load()).toBeNull();
  useStorage(fakeLocalStorage());
  localStorage.setItem('gt.web-access', 'not json');
  expect(await browserStore.load()).toBeNull();
});

test('the web app remembers sign-in only when the build asks it to', () => {
  expect(webTokenStore('1')).toBe(browserStore);
  expect(webTokenStore(undefined)).toBe(memoryStore);
  expect(webTokenStore('')).toBe(memoryStore);
});
