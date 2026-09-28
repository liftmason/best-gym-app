// Run before the web export (render.yaml): the API's address is built into the web app, so a
// malformed EXPO_PUBLIC_API_URL fails the build here with the value shown, instead of shipping
// an app that can only say "Can't reach Liftmason". It must be the bare address, e.g.
// https://api.liftmason.com: https (http only for this machine), no path, no spaces.
const value = process.env.EXPO_PUBLIC_API_URL;

// Unset is fine: development builds use localhost (src/api/config.ts).
if (value !== undefined && value !== '') {
  const bare = value.replace(/\/+$/, '');
  const remote = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  if (!remote.test(bare) && !local.test(bare)) {
    console.error(
      `EXPO_PUBLIC_API_URL must be the API's bare address, like https://api.liftmason.com, ` +
        `with no path or spaces. It is: ${JSON.stringify(value)}`,
    );
    process.exit(1);
  }
}
