# Operations

> **Superseded for the rebuild (26 September 2026).** This describes running the current Django + HTMX site, including the free-tier trial. Since sub-project 0 the pages are gone and nothing is deployed; the parts about settings, storage, email, the admin and the cron job still describe the backend, run from `backend/`. Launch hosting is planned there (Render Virginia for the API and Postgres, Cloudflare Pages for the web app, EAS for phone builds) and this file gets rewritten in sub-project 8.

Running the site on Render: the services, the settings to set by hand, form-video storage
on Cloudflare R2, the hourly cron job, backups, and the rate limits. The build plan
(`docs/BUILD_PLAN.md`, "Render deployment") explains why it's set up this way; this file
is the checklist.

## Free-tier trial (now)

While the client tries the UI, `render.yaml` runs everything on Render's free plans. The
full setup below (paid plans, the cron job, email, form videos) is kept in
`deploy/render.paid.yaml`, ready for real use.

What's different on the free trial:

| | Free trial | Real use (paid) |
| --- | --- | --- |
| Web service | `free`: sleeps after 15 idle minutes, about a minute to wake | `starter`, always on |
| Database | `free`: 1 GB, **deleted 30 days after it's created**, no backups | paid plan with daily backups |
| Migrations | at start-up (free has no pre-deploy step) | pre-deploy step |
| Cron job | none: no morning digest, no video clean-up; the dashboard still updates alerts when opened | hourly `manage.py cron` |
| Email | off: invites are shared with "Copy link"; password resets can't be sent | Resend or Postmark |
| Form videos | off: no "Add a form video" button | Cloudflare R2 |
| Demo data | loaded once at first start (`seed_demo --if-empty`) | not loaded |

Setting it up:

1. Render dashboard → **New → Blueprint** → pick the GitHub repo. It creates the
   `gymtrainer` web service and the `gymtrainer-db` database, both free.
2. When it asks for `DEMO_PASSWORD`, choose a password for the demo accounts (not the
   published local one; the site refuses to seed without it). Give it to the client.
3. The first start migrates and loads the demo gym: coach `dana@ironridge.example` and
   athletes such as `riley@ironridge.example`, all with that password. The client can
   also sign up as a coach of their own gym and invite athletes with "Copy link".
4. Note the database's creation date: Render deletes a free database after 30 days
   (with a 14-day grace period). Move to paid before then if the trial data matters.

**One check on the live site** (security audit, 24 September): the rate limits key on
the visitor's address, taken from the last `X-Forwarded-For` entry. To confirm that's
right on Render, set `LOG_CLIENT_IP=1` on the web service, sign in once from your phone
on mobile data, and copy the `client-ip check:` line from the service's Logs. Then
remove `LOG_CLIENT_IP`.

The demo's dates are relative to the day it was seeded, so the demo week drifts into the
past as the trial goes on.

## Bug reports and the admin

Both headers have a **Report a bug** button (the coach's top bar, and the bug icon in the
athlete app's header). Reports go to the Django admin under **Dashboard → Bug reports**,
newest first, with the page, the browser, the screen size, who sent it and their gym.
Set each one's status (new / seen / fixed / won't fix) as you go; add notes in "Admin note".

The admin account comes from two settings on the web service, applied at every start
(`manage.py ensure_admin`):

1. In the Render dashboard, open the `gymtrainer` web service → **Environment**, and add
   `ADMIN_EMAIL` (your email) and `ADMIN_PASSWORD` (at least 12 characters). Optionally
   `ADMIN_PATH`, e.g. `manage-7f3k2/`, to move the admin away from `/admin/`.
2. Save; Render restarts the service. Sign in at `https://<your site>/admin/` (or your
   `ADMIN_PATH`) with that email and password.

Changing `ADMIN_PASSWORD` later changes the password at the next start.

## Moving to paid

1. Copy `deploy/render.paid.yaml` over `render.yaml`, commit and push; sync the Blueprint
   in the Render dashboard. It moves the web service to `starter`, adds the hourly
   `gymtrainer-cron` job and the email and storage settings.
2. Upgrade the existing database to a paid plan in the dashboard, rather than creating a
   new one (a new database would start empty).
3. Set the settings in "Settings to set in the Render dashboard" below, and set up R2
   ("Form videos on Cloudflare R2").
4. Remove `DEMO_PASSWORD`, and delete the demo gym's coach and athletes if the client's
   real gym is going in alongside it.

## Services (`deploy/render.paid.yaml`)

| Service | What it runs |
| --- | --- |
| `gymtrainer` (web) | gunicorn, 3 workers; migrations run in the pre-deploy step |
| `gymtrainer-cron` (cron, hourly) | `manage.py cron`: attention alerts, form-video clean-up, each gym's 7am digest |
| `gymtrainer-db` (Postgres 16) | the database; see "Backups" for the plan it needs |

**After syncing the blueprint that introduced `gymtrainer-cron`**, delete the old
`gymtrainer-nightly` cron service in the Render dashboard. Render doesn't remove services
a blueprint no longer lists.

## Settings to set in the Render dashboard

Set these on **both** the web service and the cron job, unless marked otherwise.

| Variable | Example | Notes |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `resend` | or `postmark`; without it email goes to the log |
| `EMAIL_API_KEY` | | from the provider |
| `APP_NAME` | `Liftmason` | the product's name in emails and the API's title; see "Naming the app" |
| `DEFAULT_FROM_EMAIL` | `Liftmason <coach@liftmason.com>` | a sender the provider has verified |
| `SITE_URL` | `https://gymtrainer.onrender.com` | cron job only: the digest's links |
| `PUSH_PROVIDER` | `expo` | set by the blueprint; see "Push notifications" |
| `STORAGE_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` | form videos |
| `STORAGE_BUCKET` | `gymtrainer-videos` | |
| `STORAGE_ACCESS_KEY` | | R2 API token's access key id |
| `STORAGE_SECRET` | | R2 API token's secret |
| `ADMIN_PATH` | `manage-7f3k2/` | web only: the Django admin's address, instead of the guessable `admin/` |
| `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` | `app.yourdomain.com`, `https://app.yourdomain.com` | web only, once a custom domain is added |

Without the four `STORAGE_*` settings the site works and the athlete app simply has no
"Add a form video" button.

## Form videos on Cloudflare R2

Athletes' form videos go straight from their phone to the bucket (a signed upload URL,
15 minutes, exactly the file's size, at most 200 MB); Django never handles the bytes.
Coaches watch them from a signed link that lasts an hour. Files are deleted 90 days after
upload; the session keeps a note that there was one and the coach's feedback.
Exercise demo videos are unaffected: they stay YouTube links.

1. In Cloudflare: **R2 → Create bucket**, e.g. `gymtrainer-videos`, location automatic.
   Leave public access **off**.
2. **R2 → Manage API tokens → Create API token**: permission *Object Read & Write*,
   limited to that bucket. Copy the access key id, the secret and the S3 endpoint
   (`https://<account id>.r2.cloudflarestorage.com`).
3. Set the four `STORAGE_*` variables on the web service and the cron job.
4. Allow uploads from the site (CORS). Either run, from the web service's Render shell:

       python manage.py storage_setup --origin https://gymtrainer.onrender.com

   (add another `--origin` for a custom domain), or in Cloudflare: **bucket → Settings →
   CORS policy**:

   ```json
   [{"AllowedOrigins": ["https://gymtrainer.onrender.com"],
     "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["*"],
     "MaxAgeSeconds": 3600}]
   ```
5. Check: as an athlete, add a video in the session player; it should upload with a
   progress bar and appear in the coach's feed.

Locally and in CI a MinIO container stands in for R2 (`make db` starts it and creates the
bucket).

## The cron job

`manage.py cron` runs at minute 0 of every hour:

- brings every coach's "Needs your attention" feed up to date (the same checks the
  dashboard runs when it's opened);
- deletes form videos older than 90 days, and uploads that were started a day ago but
  never finished;
- sends the morning digest to coaches whose gym has just reached 7am, if something new
  needs their attention (coaches can turn it off in Settings).

Its log line reads `cron: N video(s) expired, N unfinished upload(s) removed, N digest(s) sent`.

## Backups

Render's **free** Postgres has no backups and expires; the build plan calls for the
smallest paid instance, which has daily backups. `render.yaml` doesn't set a plan yet:
choose one in the dashboard (or add `plan:` to the database in `render.yaml`) before real
athletes' data goes in.

**Restore drill** (do it once before launch, then every few months):

1. Render dashboard → the database → **Recovery / Backups** → restore the latest backup
   to a **new** database (never over the live one).
2. Open a shell on the web service with the new database's internal URL:

       DATABASE_URL=<restored database URL> python manage.py backup_check

   and compare with `python manage.py backup_check` against the live database. The
   counts should match up to the backup's time, and "newest finished session" should be
   from shortly before it.
3. Delete the restored database afterwards (it costs money while it exists).

## Rate limits

Counts live in the `ratelimit_counter` table, one row per key, shared by all workers; the
hourly cron deletes expired rows. Over a limit the API answers 429 with the usual error
shape.

| What | Limit |
| --- | --- |
| Sign-in codes | 5 per 15 minutes per email; 30 per address |
| The admin's password sign-in | 10 tries per 15 minutes per address and email; 50 per address; 30 per email from any address |
| Coach sign-up, joining by invite | 10 per hour per address |
| Invites | 30 per hour per coach |
| Messages | 30 per minute per person |
| Form-video uploads | 20 per hour per athlete |
| Bug reports | 20 per hour per person |
| Metrics reminder emails | 1 per day per athlete |

## The app (Expo)

One Expo app in `app/` for iOS, Android and the web (`app/README.md` has the commands).

- **Expo project:** `spearws-team/best-gym-app` on expo.dev (the id is in `app/app.json`). Builds and store submissions go through EAS (`npx eas-cli@latest build`), once the Apple and Google developer accounts exist.
- **Web hosting:** Cloudflare Pages serving the export (`npm run export:web`, output `app/dist/`).
  - `app/public/_headers` sets the headers. The local database needs its cross-origin isolation headers on every page.
  - Pages treats a site without a `404.html` as a single-page app, so links like `/join/<token>` work.
  - Set `EXPO_PUBLIC_API_URL` to the API's address when building.
  - Add the site's address to the API's `WEB_APP_ORIGINS`.
- **Trying the export locally:** `npm run serve:web` serves `dist/` on :8082 with the same headers.

## Naming the app

The product is **Liftmason** (chosen 28 September 2026; the code name was GymTrainer). Before
launch, a trademark clearance search should confirm it, LiftMaster (Chamberlain's garage-door
brand) being the name to ask about. What people see is written once
on each side, and tests fail if a screen, an email or the API spells it out instead:

- **The app:** `expo.name` in `app/app.json`. Screens use `APP_NAME` (`app/src/name.ts`), and
  iOS permission prompts say `$(PRODUCT_NAME)`, which is the same name.
- **The backend:** the `APP_NAME` setting (an environment variable, default in
  `config/settings/base.py`). Emails say `{% app_name %}`; the API's title and the default
  sender use it. Then run `python manage.py openapi` (the title is in `openapi.json`).
- **The sender:** `DEFAULT_FROM_EMAIL` in production, e.g. `NewName <coach@newdomain>`.
- **The mockup** (`mockup/index.html`) says it in five places.

**Fix these before the first store build or real invite**, since they can't change afterwards
(or only by breaking links people have):

- `ios.bundleIdentifier` and `android.package` in `app/app.json` (not set yet; `com.liftmason.app`
  is the plan).
- `expo.scheme` (`liftmason`): the app's link scheme.
- The web and API domains, `SITE_URL`, and the email sender's domain (liftmason.com and
  liftmason.app were free on 28 September 2026).

Internal names can stay as they are, since no one sees them: the Expo slug `best-gym-app`
(Expo can't rename a slug; the project's display name is Liftmason), the GitHub repository
`best-gym-app`, and `gymtrainer` for the database and its user, the storage bucket, the Render
services, the Python and npm package names and the local database file.

## Push notifications

The API sends pushes through Expo's push service: athletes hear of coach messages and published weeks; coaches of athlete messages, issues and form videos. Every push also makes the app sync.

| Variable | Notes |
| --- | --- |
| `PUSH_PROVIDER` | `expo` to send; `console` logs them. Production refuses to start without it (the blueprint sets `expo`). |
| `EXPO_ACCESS_TOKEN` | only if the Expo project turns on "enhanced push security" |

- **Needs a build:** pushes reach phones running a build of our app, not Expo Go on Android.
- **Android:** it also needs Firebase (FCM) credentials uploaded to the Expo project.
- **iOS:** it needs the Apple push key, which EAS sets up during the first iOS build.
- **Failures:** a failed push is logged and never fails the request. A token Expo reports as gone is forgotten.

## Sign in with Apple and Google

Set the client ids tokens are issued to, comma-separated. Each provider is off until its ids are set.
- `APPLE_CLIENT_IDS`: the iOS bundle id, and the web Services ID.
- `GOOGLE_CLIENT_IDS`: the iOS, Android and web client ids.

The app asks `GET /api/v1/auth/nonce` for a nonce before each sign-in and gives the provider its SHA-256.

## Billing (Stripe)

Billing is off until `BILLING_ENABLED=1`; everything is allowed until then. Production refuses `BILLING_ENABLED` without both Stripe keys. To turn it on:

1. **Plans:** in the admin, create them with their limits and the Stripe price id; tick "public" for the ones offered. Set `DEFAULT_PLAN` to the plan new gyms get.
2. **Keys:** `STRIPE_SECRET_KEY`, and in Stripe add a webhook endpoint for `https://<api host>/api/v1/billing/webhook` with these events:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`
   - `invoice.paid` and `invoice.payment_failed`

   Its signing secret is `STRIPE_WEBHOOK_SECRET`.
3. **Local testing:** `stripe listen --forward-to localhost:8000/api/v1/billing/webhook` prints a signing secret to use.

A failed payment gives the gym 7 days of full access, then coach programming is read-only until it's paid. Athletes are never affected.

## Sync (athletes' phones)

**The change log.** Every write to a synced table adds a row to `sync_change`, through a Postgres trigger. The hourly cron deletes rows older than 90 days. A phone that hasn't synced for that long downloads everything again.

**Schema version.** The sync endpoints need `X-Schema-Version` to be the current version (`SCHEMA_VERSION` in `apps/sync/schema.py`) or the one before. Bump it, with a note in the release, when a synced table changes shape. The phone's tables come from `shared/sync-schema.json` (`manage.py sync_schema`, then `npm run db:schema` in `app/`); a phone on the new version drops its copy and downloads it again, keeping what it hasn't sent.

**Checking a trigger.** A new synced table needs its trigger (a migration calling `apps.sync.triggers.install` for it); a test fails until it has one.
