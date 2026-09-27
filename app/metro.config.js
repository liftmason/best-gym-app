// Metro for the web database (expo-sqlite runs SQLite as WebAssembly in a worker):
// - bundle .wasm files;
// - the dev server sends the cross-origin isolation headers SQLite needs on the web
//   (SharedArrayBuffer). Hosting sends the same headers (web/_headers, S4b step 9).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  return middleware(req, res, next);
};

module.exports = config;
