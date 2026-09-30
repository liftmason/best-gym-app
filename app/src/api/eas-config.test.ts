/**
 * The phone builds' API addresses (eas.json). Test builds ("preview") use the same API as the
 * web test run (render.yaml), so a phone and a browser see the same data; store builds use the
 * permanent address. Every address is bare https, like scripts/check-api-url.mjs wants.
 */
import eas from '../../eas.json';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFileSync } = require('node:fs') as { readFileSync: (file: string, encoding: 'utf8') => string };

const BARE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

test('every build profile with an API address has a bare https one', () => {
  const addresses = Object.values(eas.build).flatMap((profile) => ('env' in profile ? [profile.env.EXPO_PUBLIC_API_URL] : []));
  expect(addresses.length).toBeGreaterThan(0);
  for (const address of addresses) expect(address).toMatch(BARE);
});

test('test builds use the web test run’s API', () => {
  const blueprint = readFileSync('../render.yaml', 'utf8');
  const web = /key: EXPO_PUBLIC_API_URL\s+value: (\S+)/.exec(blueprint)?.[1];
  expect(eas.build.preview.env.EXPO_PUBLIC_API_URL).toBe(web);
});
