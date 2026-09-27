import { holdTabLock } from './tab-lock';

/** Web Locks as a browser shares them between tabs: one holder per name. */
function browser() {
  const held = new Set<string>();
  return {
    release: (name: string) => held.delete(name),
    request: async (name: string, _options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<unknown>) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      return callback({ name });
    },
  };
}

test('the first tab holds the database; a second is told, and can try again once it is free', async () => {
  const locks = browser();
  const first = jest.requireActual<typeof import('./tab-lock')>('./tab-lock');
  expect(await first.holdTabLock(locks)).toBe(true);
  expect(await first.holdTabLock(locks)).toBe(true); // the same tab again

  let second!: typeof import('./tab-lock');
  jest.isolateModules(() => {
    second = jest.requireActual('./tab-lock');
  });
  expect(await second.holdTabLock(locks)).toBe(false);
  locks.release('gymtrainer-database'); // the first tab closed
  expect(await second.holdTabLock(locks)).toBe(true);
});

test('without Web Locks the database decides', async () => {
  expect(await holdTabLock(undefined)).toBe(true);
});
