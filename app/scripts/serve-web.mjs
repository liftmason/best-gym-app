// Serves the web export (npx expo export -p web → dist/) with the headers in public/_headers,
// as Cloudflare Pages will, and answers unknown paths with index.html (a single-page app).
// Run: npm run serve:web   (then open http://localhost:8082)
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 8082);

/** [pattern, {header: value}] from a _headers file ("/*" and "/prefix/*" patterns). */
export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push([line.trim(), {}]);
    else if (rules.length) {
      const at = line.indexOf(':');
      rules.at(-1)[1][line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return rules;
}

export function headersFor(rules, path) {
  const out = {};
  for (const [pattern, headers] of rules) {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
    if (prefix !== null ? path.startsWith(prefix) : path === pattern) Object.assign(out, headers);
  }
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('No export yet: run `npx expo export -p web` first.');
    process.exit(1);
  }
  const rules = parseHeaders(readFileSync(join(root, 'public/_headers'), 'utf8'));
  createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(dist, path));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...headersFor(rules, path) });
    createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`Serving dist/ on http://localhost:${port}`));
}
