# GymTrainer app

One Expo app for iOS, Android and the web: athletes train offline-first, coaches work online.
The design is `docs/EXPO_MIGRATION.md` (section 6); this sub-project's plan is
`docs/plans/S4_APP_FOUNDATION.md`. Read `AGENTS.md` before touching Expo APIs.

```
npm install
npm start           # the dev server: press a for Android (Expo Go), w for the web
npm run typecheck
npm run lint
npm test
npm run api:types   # after the backend's openapi.json changes (CI fails if stale)
```

The backend must be running for the app to do anything (from the repo root).

## Trying it

- **Web:** `make run`, then `npm run web` here, and open http://localhost:8081.
- **Android phone (Expo Go):** `make run-lan`, then `npm start` here and scan the QR code with
  Expo Go. The phone and computer must be on the same Wi-Fi. The app calls port 8000 at the
  address the phone loaded it from.
  - On WSL2, the phone can only reach it with mirrored networking: add `networkingMode=mirrored`
    under `[wsl2]` in `%UserProfile%\.wslconfig`, run `wsl --shutdown`, and allow ports 8000
    and 8081 through the Windows firewall when asked.
- **Signing in:** the seeded demo accounts (`make seed`, e.g. `dana@ironridge.example`) take the
  code `123456`. Any other email gets its code printed in the backend's console.
- **The kit screen** (development only): `/kit` shows every component.

## Layout

- `src/app/`: routes (Expo Router): `(auth)` signing in, `(training)` the athlete, `(coaching)` the coach.
- `src/ui/`: the theme and component kit, from the mockup's design tokens.
- `src/api/`: the API client, typed from `backend/openapi.json`, with tokens and refresh. Set
  `EXPO_PUBLIC_API_URL` for a deployed backend; in development it's port 8000 on the dev machine.
- `src/db/`: the local database (SQLite behind one queue).
- `src/sync/`: pull, push and the outbox.
- `src/domain/`: rules the phone runs offline, checked against `shared/rules-cases.json`.

Screens never fetch or touch SQLite directly: training screens go through `db/` and `sync/`,
coaching screens through `api/`.
