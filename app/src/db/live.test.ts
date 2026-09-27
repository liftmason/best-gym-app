import { makeDatabase } from './database';
import { watch } from './live';
import { openNodeDriver } from './node-driver';
import { prepare } from './setup';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a burst of writes to a watched table re-runs once; other tables are ignored', async () => {
  const database = makeDatabase(openNodeDriver());
  await prepare(database);
  const onChange = jest.fn();
  const stop = watch(database, ['outbox'], onChange);
  for (let n = 0; n < 20; n += 1) {
    await database.write((tx) => tx.run('INSERT INTO outbox (id, name, payload, at) VALUES (?, ?, ?, ?)', [`a${n}`, 'x', '{}', 'now']));
  }
  await database.write((tx) => tx.run("INSERT INTO sync_state (key, value) VALUES ('k', 'v')"));
  jest.advanceTimersByTime(60);
  expect(onChange).toHaveBeenCalledTimes(1);
  await database.write((tx) => tx.run("INSERT INTO outbox (id, name, payload, at) VALUES ('b', 'x', '{}', 'now')"));
  stop();
  jest.advanceTimersByTime(60);
  expect(onChange).toHaveBeenCalledTimes(1); // stopped
});
