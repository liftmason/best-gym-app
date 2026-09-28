# S8b, part 1: the test run on free tiers

*28 September 2026 · design agreed with the owner in conversation; follows the web-first decision (`docs/EXPO_MIGRATION.md`, "Decided at launch")*

The web app goes live for initial testing with coaches and athletes the owner knows. Because the product is still in active development, the test run uses free tiers and the owner's personal accounts. Decisions that are expensive or hard to undo wait until the owner decides to go public:
- a business entity owning the accounts;
- paid seats for Steven;
- the Apple and Google accounts.

Going public is then mostly an upgrade in place, not a migration.

## 1. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| A | **Whose accounts** | **The owner's, personally**, on free tiers. Steven keeps admin wherever that's free. | A business entity isn't decided yet. Everything used in the test run can be handed over later. The two services that can't (Apple, Google Play) aren't opened until then. |
| B | **Sign-up email** | **`ops@liftmason.com`**, forwarded to the owner's Gmail with a copy to Steven (Cloudflare Email Routing, free). Cloudflare itself uses the owner's Gmail, because it must exist before the domain does. | Handing the accounts to a business later means changing where one address forwards, not the email on every account. |
| C | **The GitHub repository** | Moves into a free **`liftmason` organization**. The owner and Steven are both owners. | A collaborator on a personal repo can't be an admin. GitHub redirects the old `spearw/best-gym-app` address. Moving first means Render and Cloudflare connect to the final address. |
| D | **Render** | **A Hobby workspace (free, one member)**: a free web service and a free Postgres. Steven has no Render login during the test run. Merging to `main` deploys. | A second member needs the Pro plan ($25 a month). A free database is deleted 30 days after it's created, but upgrading it keeps the data. |
| E | **The hourly job** | **A scheduled GitHub Actions workflow calls `POST /api/v1/ops/cron`** with a secret token. The endpoint runs the same steps as `manage.py cron`. | Render has no free cron jobs. Only the token is stored in GitHub, not the database address and service keys. The public repo's Actions logs show nothing from the job. The call also wakes the sleeping API. |
| F | **Sentry** | **The free Developer plan (one user)**, with alert emails to both. | Team is $26 a month; alerts carry the error and the stack trace. |
| G | **When to upgrade** | Any one of: testing passes **day 25** of the free database; cold starts get in the way of feedback; **anyone outside the test group** signs up. | The free database is deleted on day 30, with a 14-day grace period to upgrade. |
| H | **Apple, Google Play, Stripe** | **Not opened in the test run.** Decide on a business entity first. | Google Play personal accounts can never become organization accounts, and new ones must run a 14-day closed test with 12 testers. An individual Apple account shows the owner's legal name as the seller. |

### Where each account lives

| Service | Owner | Steven | Plan |
|---|---|---|---|
| Cloudflare: registrar, DNS, email routing, R2, Pages | the owner (Gmail) | Administrator | Free, plus the domain (about $10 a year) |
| GitHub: the `liftmason` organization | the owner | Owner | Free |
| Render | the owner (`ops@`) | none yet | Hobby: free web service and Postgres |
| Resend | the owner (`ops@`) | Admin, if the free plan allows it (the invite tells us) | Free, 3,000 emails a month |
| Sentry | the owner (`ops@`) | alert emails only | Developer (free) |
| Expo: the `spearws-team` team | the owner | Admin | Free |

**Security on every account:**
- Two-factor sign-in, preferably a passkey or an authenticator app, never SMS.
- Recovery codes kept in the password manager.
- **Domain auto-renew switched on.** Every account's password reset depends on `ops@` receiving mail.

## 2. What changes in the repository

**`render.yaml`, on free plans:**
- **The web service:** `plan: free`.
  - Free services have no pre-deploy command, so migrations and `ensure_admin` run in the start command: `python manage.py migrate --noinput && python manage.py ensure_admin && gunicorn …`. `ensure_admin` was written for this case: it creates or updates the admin from the settings at start-up.
  - **2 gunicorn workers** instead of 3, to fit the free instance's 512 MB.
- **The database:** `plan: free`.
- **No cron service.** A comment explains why and what replaces it.
- A header comment lists the changes to reverse when upgrading, so going public is one small commit.
- `backend/tests/unit/test_render_blueprint.py`: the service count becomes one. The Virginia check and the every-setting-listed check stay.

**The cron endpoint, written test-first:**
- It's a POST to `/api/v1/ops/cron` with `Authorization: Bearer <CRON_TOKEN>`. It runs the same steps as `manage.py cron`, moved into one function that both call, so they can't drift apart.
- It answers **404** when `CRON_TOKEN` isn't set, or when the token is missing or wrong, so the endpoint doesn't reveal that it exists. The token is compared in constant time.
- On success, it answers with the summary line's counts. If a step failed, it answers **500** after running every step, as `manage.py cron` exits with an error (audit H10), so the failed run shows in GitHub.
- It isn't in the app's generated API types, since the app never calls it.
- `CRON_TOKEN` goes in `render.yaml` (web service, `sync: false`) and in `backend/config/settings/base.py`. The blueprint test keeps them in step.

**`.github/workflows/cron.yml`:**
- Runs at minute 0 of every hour, and can also be started by hand (`workflow_dispatch`).
- A `curl` with the token from the repository secret `CRON_TOKEN`, a generous timeout for the cold start, and one retry.
- It does nothing when the secret isn't set, so forks and the paid setup stay quiet.
- Known limits:
  - GitHub may start scheduled runs 10–30 minutes late, which the alerts and "after 7am" digest tolerate;
  - GitHub switches scheduled workflows off after 60 days with no activity on the repository.

**Docs:**
- `docs/LAUNCH.md` Part 1 is rewritten for the test run, in the order below, and gains an **"Upgrading to paid"** section.
- `docs/EXPO_MIGRATION.md`: a row in "Decided at launch".
- `docs/OPERATIONS.md`: the cron section covers both setups.

## 3. The owner's steps (the new `docs/LAUNCH.md` Part 1)

1. **GitHub:**
   - create the `liftmason` organization;
   - transfer `best-gym-app` into it;
   - make Steven an owner;
   - update local remotes (`git remote set-url origin git@github.com:liftmason/best-gym-app.git`).
2. **Cloudflare:**
   - open the account with the Gmail address, with two-factor sign-in;
   - buy `liftmason.com` with auto-renew on;
   - Email Routing: `ops@liftmason.com` to the owner's Gmail, with a second rule or destination for Steven;
   - invite Steven as Administrator.
3. **Resend, Sentry, Expo** (sign up with `ops@`):
   - Resend: verify the domain, add DMARC, create the API key, invite Steven;
   - Sentry: create the two projects, and add Steven's email to alert rules;
   - Expo: make Steven an Admin of `spearws-team`.
4. **R2:** the video bucket and its token (unchanged from the current runbook).
5. **Render, on the day testing starts** (this starts the free database's 30 days):
   - New Blueprint from `liftmason/best-gym-app`, with the settings as in the current runbook, plus `CRON_TOKEN` (a long random value);
   - the `api.liftmason.com` custom domain;
   - `storage_setup --origin https://app.liftmason.com` from a laptop, with the four production `STORAGE_*` settings in the environment. It only touches R2, not the database. Or set the same CORS rule in R2's dashboard.
6. **Cloudflare Pages** on `app.liftmason.com` (unchanged).
7. **The hourly job:**
   - add the same `CRON_TOKEN` as a repository secret;
   - start the workflow by hand once;
   - check that Render's log shows the `cron:` line.
8. **Checks:**
   - the computer run-through and the phone-browser check (iPhone Safari, Android Chrome);
   - the rate-limit IP check;
   - a backup restore drill is **not possible on the free database** (it has no backups), so it moves to the upgrade.
9. **Invite testers.** Tell them:
   - the first visit after a quiet spell takes about a minute to wake up;
   - the web limits (no notifications, offline only while the page is open, one tab, add to the home screen on iPhone).
10. **Diary:** day 25 after step 5, decide whether to upgrade (decision G).

## 4. Steven's old Render account

The trial on Steven's free Render account was suspended before S0 merged: its address answers Render's "no-server", and the last deploy was on 26 September. Its database was empty, so nothing moves. To finish:
- **Steven** deletes the `gymtrainer` service and `gymtrainer-db` in his Render workspace.
- **Steven** removes Render's access to the repository (Render → Account settings → GitHub, or github.com/settings/installations).
- **The owner, or Claude Code with the owner's go-ahead,** deletes the stale GitHub deployment environments `main - gymtrainer` and `main - gymtrainer-db`.

## 5. Upgrading to paid (going public)

About $14 a month, all in place in the same Render workspace:
1. Render: the database to `basic-256mb` (data kept), and the web service to `starter`.
2. `render.yaml`:
   - the paid plans;
   - migrations back in `preDeployCommand`, and 3 workers;
   - the `gymtrainer-cron` service restored.
   
   Sync the blueprint.
3. Remove `CRON_TOKEN` from Render and from the GitHub secrets. The workflow and the endpoint go quiet. The code stays.
4. Do the backup restore drill (`docs/OPERATIONS.md`).
5. Only if Steven needs his own logins: Render Pro ($25 a month) and Sentry Team ($26 a month).
6. **Before opening Apple or Google Play:** decide whether a business owns the accounts. If one does:
   - point `ops@` at the business;
   - make the business the owner in Cloudflare, GitHub, Expo and Resend;
   - for Render, which can't move services between workspaces, recreate the services from `render.yaml` in the business's workspace and restore the database from a dump.
   
   Then follow Part 2 of `docs/LAUNCH.md`.

## 6. Testing

- **The cron endpoint**, test-first:
  - 404 without `CRON_TOKEN` configured, with no token, and with a wrong one;
  - 200 with the right one, and the steps run;
  - 500 when a step fails, and the other steps still run;
  - `manage.py cron` and the endpoint share the step list.
- **The blueprint test** passes on the free blueprint.
- **`make check`** still passes. It checks the production settings, which don't depend on the plan.
- **The workflow** is checked by starting it by hand after step 7. It can't run in CI before there's a deployment.

## 7. Size

About a day of code and docs, then the owner's steps (a few hours, spread over the days the domain and email records take).
