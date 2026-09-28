# End-to-end tests (Playwright)

The coach's web flows against a real backend with the demo gym. CI runs them on every push (job `e2e` in `.github/workflows/ci.yml`).

To run them locally:

1. **Use a database you don't mind reseeding.** `seed_demo --reset` replaces the demo gym. For example, run `createdb -U gymtrainer gymtrainer_e2e` in the Postgres container, then set `DATABASE_URL=postgres://gymtrainer:gymtrainer@localhost:5432/gymtrainer_e2e` for the next two steps.
2. **Prepare the backend.** From `backend/`, run `python manage.py migrate` and then `python manage.py seed_demo --reset`.
3. **Start the backend.** From `backend/`, run `python manage.py runserver 8000`.
4. **Build and serve the web app.** From `app/`, run `npx expo export --platform web`, then `npm run serve:web`.
5. **Run the tests.** From `app/`, run `npx playwright install chromium` once, then `npm run e2e`.

Sign-in codes are rate-limited: 5 per email every 15 minutes. If several runs in a row fail at sign-in, wait for the limit to reset.
