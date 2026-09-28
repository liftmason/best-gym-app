// The app's TypeScript has no Node types, so Node's modules come in typed by hand (as in name.test.ts).
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require('node:child_process') as {
  spawnSync: (
    command: string,
    args: string[],
    options: { env: Record<string, string | undefined>; encoding: 'utf8' },
  ) => { status: number | null; stderr: string };
};

const SCRIPT = `${__dirname}/check-api-url.mjs`;

/** Runs the web build's address check with EXPO_PUBLIC_API_URL set (or not). */
function check(value: string | undefined) {
  const env = { ...process.env };
  delete env.EXPO_PUBLIC_API_URL;
  if (value !== undefined) env.EXPO_PUBLIC_API_URL = value;
  const run = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  return { ok: run.status === 0, message: run.stderr };
}

test('a bare https address passes, with or without a trailing slash', () => {
  expect(check('https://gymtrainer-kqrl.onrender.com').ok).toBe(true);
  expect(check('https://api.liftmason.com/').ok).toBe(true);
});

test('no address passes: development builds use localhost', () => {
  expect(check(undefined).ok).toBe(true);
});

test('a local address may be http, for trying the export on this machine', () => {
  expect(check('http://localhost:8000').ok).toBe(true);
});

test('a pasted-over or partial address fails the build with the value in the message', () => {
  // What the first test-run deploy shipped: the new address typed over only "https".
  const broken = check('https://gymtrainer-kqrl.onrender.com://gymtrainer.onrender.com');
  expect(broken.ok).toBe(false);
  expect(broken.message).toContain('https://gymtrainer-kqrl.onrender.com://gymtrainer.onrender.com');
  expect(check('gymtrainer-kqrl.onrender.com').ok).toBe(false); // no scheme
  expect(check('https://api.liftmason.com/api/v1').ok).toBe(false); // a path
  expect(check('http://api.liftmason.com').ok).toBe(false); // not https
  expect(check(' https://api.liftmason.com').ok).toBe(false); // stray space
});
