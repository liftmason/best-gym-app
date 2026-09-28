/** The name is written once, in app.json, so renaming the app is one change. */
import { APP_NAME } from './name';

type Entry = { name: string; isDirectory(): boolean };
const { readdirSync, readFileSync } = require('node:fs') as {
  readdirSync: (dir: string, options: { withFileTypes: true }) => Entry[];
  readFileSync: (file: string, encoding: 'utf8') => string;
};

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );
}

test('no screen spells out the name', () => {
  const all = files('src'); // Jest runs from app/
  expect(all.length).toBeGreaterThan(50);
  expect(all.filter((f) => readFileSync(f, 'utf8').includes(APP_NAME))).toEqual([]);
});
