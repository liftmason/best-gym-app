# Phone flows (Maestro)

These are the design's phone checks: an athlete logs a whole session with no signal, then comes back online and it syncs. They run on Android, because Maestro can switch airplane mode there.

They need things that come with S8b (`docs/LAUNCH.md`):

- **A development build** on an Android phone or emulator, from `eas build --profile development --platform android`. Expo Go can't run them: its app id isn't `com.liftmason.app`.
- **A backend with the demo gym** that the phone can reach, such as `make dev` on the same Wi-Fi, run with `make run-lan`.
- **Maestro itself.** Install it with `curl -fsSL https://get.maestro.mobile.dev | bash`.

Then, from `app/`, run `maestro test .maestro/athlete-offline-session.yaml`.

Before each release, also do the manual check the design asks for:
1. Switch a real phone to airplane mode.
2. Open the app and log a session.
3. Reconnect, and confirm the coach sees it.
