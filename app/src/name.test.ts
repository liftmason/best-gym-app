/** The name is written once, in app.json, so renaming the app is one change. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_NAME } from './name';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

test('no screen spells out the name', () => {
  const spelled = files(__dirname).filter((f) => readFileSync(f, 'utf8').includes(APP_NAME));
  expect(spelled).toEqual([]);
});
