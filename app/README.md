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
```

The backend must be running for the app to do anything (`make run` from the repo root).

## Layout

- `src/app/`: routes (Expo Router): `(auth)` signing in, `(training)` the athlete, `(coaching)` the coach.
- `src/ui/`: the theme and component kit, from the mockup's design tokens.
- `src/api/`: the API client, generated from `backend/openapi.json`.
- `src/db/`: the local database (SQLite behind one queue).
- `src/sync/`: pull, push and the outbox.
- `src/domain/`: rules the phone runs offline, checked against `shared/rules-cases.json`.

Screens never fetch or touch SQLite directly: training screens go through `db/` and `sync/`,
coaching screens through `api/`.
