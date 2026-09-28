# Launching Liftmason: the runbook

*For the owner (S8b). Written 28 September 2026 at the end of S8a (`docs/plans/S8_LAUNCH.md`). The same day, the owner chose to launch on the web first, as a free test run in their own name (`docs/plans/S8B_TEST_RUN.md`).*

**Where things stand.** The app is built and tested: the backend, the web app, and the iOS and Android apps. Nothing is deployed and nothing is in a store.

**The plan:**
- **Part 1, the test run (now).** The web app at `app.liftmason.com`, tested with coaches and athletes you know. It runs on free tiers, in your name. The domain is the only cost.
- **Upgrading to paid (going public).** An upgrade in place, about $14 a month. Nothing in Part 1 is redone.
- **Part 2, the stores (after testing).** Apple and Google accounts, a designed icon, phone builds, and submission.

**How to use it.** Each step says:
- what to do;
- what it costs;
- what to paste where;
- how to check it worked.

Settings you enter are marked like `THIS`. Keep them in a password manager as you go.

**Get help:** anything in `code` is either a setting name or a command to run. Steven (or Claude Code) can run the commands.

---

## 0. Costs and time

| What | Cost | Time to set up | When |
|---|---|---|---|
| Domain `liftmason.com` | about $10 a year | minutes | Part 1 |
| Cloudflare: DNS, email forwarding, website, video storage | free | an hour | Part 1 |
| Render: API and database, in Virginia | **free during testing**; about $14 a month when going public (API $7, database $6, hourly job about $1) | an hour | Part 1 |
| Resend: email | free up to 3,000 emails a month | 30 minutes | Part 1 |
| Sentry: crash reports | free (one user) | 20 minutes | Part 1 |
| GitHub organization | free | minutes | Part 1 |
| Render Pro | $25 a month | minutes | Only if Steven needs his own Render login |
| Sentry Team | $26 a month | minutes | Only if Steven needs his own Sentry login |
| Apple Developer Program | $99 a year | **days to weeks** (an organisation needs a D-U-N-S number) | Part 2 |
| Google Play Console | $25 once | a few days | Part 2 |
| Expo (EAS builds) | free tier (limited builds a month), or $19 a month for faster builds | exists | Part 2 |
| Stripe: gym subscriptions | a fee per payment, when billing is turned on | later | When you charge |

**Part 1 costs the domain, about $10 a year.**

**Who has access.** The accounts are yours. Steven is an admin wherever that's free:

| Service | Steven |
|---|---|
| Cloudflare | Administrator |
| GitHub (`liftmason` organization) | Owner |
| Resend | Admin, if the free plan allows a second member (the invite will say) |
| Expo (`spearws-team`) | Admin |
| Render | No login during testing. Merging to `main` deploys. |
| Sentry | No login. Alert emails go to both of you. |

**On every account:**
- two-factor sign-in, preferably a passkey or an authenticator app, never SMS;
- recovery codes in the password manager.

---

# Part 1: the test run

## 1. GitHub

1. github.com → **Your organizations → New organization** → Free → name `liftmason`.
2. Invite Steven (`Tazz-Darkwood`) as an **Owner**.
3. The repository → **Settings → General → Danger Zone → Transfer ownership** → `liftmason`. GitHub redirects the old `spearw/best-gym-app` address, and Steven keeps his access.
4. On each computer with a checkout, point it at the new address:

       git remote set-url origin git@github.com:liftmason/best-gym-app.git

**Check:** `https://github.com/liftmason/best-gym-app` shows the repository, and CI still runs on the next push.

---

## 2. Cloudflare, the domain and the ops address

1. **Open a Cloudflare account** with your Gmail address. This is the one account that doesn't use `ops@`, because it has to exist before the domain does. Turn on two-factor sign-in.
2. **Buy `liftmason.com`** (Cloudflare → Domain Registration). Cloudflare sells domains at cost. **Turn auto-renew on:** every other account's password reset depends on this domain receiving mail.
3. **The ops address:** Cloudflare → `liftmason.com` → **Email → Email Routing**. Send `ops@liftmason.com` to your Gmail, and add Steven's address as a second destination if he should see account notices. Cloudflare adds the records it needs.
4. **Invite Steven:** Manage Account → **Members** → invite, as **Administrator**.
5. **Addresses** (Cloudflare → DNS). Keep the app and the API on this one domain: the web app's sign-in depends on it.

| Name | Points to | Set up in |
|---|---|---|
| `app.liftmason.com` | the web app | step 7 (Cloudflare Pages adds it) |
| `api.liftmason.com` | the backend | step 6 (Render gives a `CNAME` target) |
| `liftmason.com` | redirects to `https://app.liftmason.com` | Cloudflare → Rules → Redirect Rules |

**Check:** send an email to `ops@liftmason.com` from another address. It arrives in your Gmail.

---

## 3. Email (Resend)

1. **Open a Resend account** with `ops@liftmason.com`. Turn on two-factor sign-in.
2. Resend → **Domains → Add domain** → `liftmason.com`. Add the DNS records it shows (SPF, DKIM) in Cloudflare, then click **Verify**.
3. **Add a DMARC record** in Cloudflare. It's a `TXT` record named `_dmarc`, with the value `v=DMARC1; p=none; rua=mailto:ops@liftmason.com`. It stops sign-in codes from landing in spam.
4. Resend → **API Keys → Create** (sending access). This is `EMAIL_API_KEY`.
5. Resend → **Settings → Team** → invite Steven as Admin. If the free plan refuses, skip it.

**Check:** once the backend runs (step 6), sign up as a new coach with a real address. The code should arrive within a minute, and not in spam. mail-tester.com scores a message if you send it one.

---

## 4. Sentry and Expo

1. **Sentry** (sentry.io): open an account with `ops@liftmason.com` (free Developer plan). Turn on two-factor sign-in.
   - Create two projects: "liftmason-api" (Python, Django) and "liftmason-app" (React Native; it covers the web app too).
   - In each project's **Alerts**, send issue alerts to `ops@liftmason.com`. That reaches Steven too, if he's on the ops address.
2. **Expo:** the project already exists under `spearws-team` (expo.dev). Invite Steven as an Admin of that team. Nothing else in Expo is needed until Part 2.

---

## 5. Video storage (Cloudflare R2)

Cloudflare → **R2 → Create bucket** `gymtrainer-videos`, with public access **off**. Then **Manage API tokens → Create**, with "Object Read & Write" on that bucket. Note:
- the access key id (`STORAGE_ACCESS_KEY`);
- the secret (`STORAGE_SECRET`);
- the S3 endpoint (`STORAGE_ENDPOINT`).

---

## 6. The backend (Render), on the day testing starts

**Do this on the day testers start.** Render's free database is deleted 30 days after it's created, unless it's upgraded (see "Upgrading to paid").

1. **Open a Render account** with `ops@liftmason.com` (the free Hobby plan; no card needed). Turn on two-factor sign-in.
2. **Create the services:** Render → **New → Blueprint** → connect GitHub and pick the repository `liftmason/best-gym-app`.
   - Render reads `render.yaml`. It creates the API (`gymtrainer`) and the database (`gymtrainer-db`), both free and in Virginia.
3. **Fill in the settings** it asks for:

| Setting | Value |
|---|---|
| `SITE_URL` | `https://app.liftmason.com` |
| `WEB_APP_ORIGINS` | `https://app.liftmason.com` |
| `ALLOWED_HOSTS` (API) | `api.liftmason.com` |
| `CSRF_TRUSTED_ORIGINS` (API) | `https://api.liftmason.com` |
| `EMAIL_PROVIDER` | `resend` |
| `EMAIL_API_KEY` | from step 3 |
| `DEFAULT_FROM_EMAIL` | `Liftmason <no-reply@liftmason.com>` |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET` | from step 5 (`STORAGE_BUCKET` = `gymtrainer-videos`) |
| `SENTRY_DSN` | the "liftmason-api" project's DSN |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` (API) | the admin sign-in: your email, and a long password (12 characters or more) |
| `ADMIN_PATH` (API) | something unguessable, e.g. `manage-7f3k2/` |
| `CRON_TOKEN` (API) | a long random value, for the hourly job (step 8). Make one with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `LOG_CLIENT_IP` (API) | `1` for now; see step 10 |

Leave these blank:
- `REVIEW_ACCOUNT_EMAIL`, `REVIEW_ACCOUNT_CODE`: only the store reviewers need them (Part 2). Left blank, no fixed sign-in code exists.
- `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS`: not used at launch.
- `EXPO_ACCESS_TOKEN`: only if the Expo project turns on "enhanced push security".
- `BILLING_ENABLED` and the Stripe keys: see "Billing" at the end.
- `APP_NAME`.

4. **Deploy.** Each start migrates the database and creates or updates the admin account. Free services have no separate pre-deploy step.
5. **Add the API's own address:** Render → `gymtrainer` → **Settings → Custom Domains** → `api.liftmason.com`. Add the `CNAME` it gives you in Cloudflare, with the proxy switched **off** (grey cloud).
6. **Allow uploads from the web app.** Free services have no shell, so do this from a computer with a checkout. In `backend/`, with the four `STORAGE_*` values from step 5 set in the environment:

       STORAGE_ENDPOINT=… STORAGE_BUCKET=gymtrainer-videos STORAGE_ACCESS_KEY=… STORAGE_SECRET=… \
         .venv/bin/python manage.py storage_setup --origin https://app.liftmason.com

   It only touches the R2 bucket, not the database. Or set the same rule by hand: R2 → `gymtrainer-videos` → **Settings → CORS policy**, allowing `PUT`, `GET` and `HEAD` from `https://app.liftmason.com`, with any header.

**Check:**
- `https://api.liftmason.com/healthz` answers `{"status": "ok"}`. The first request after a quiet spell takes about a minute while the free service wakes up.
- `https://api.liftmason.com/<ADMIN_PATH>` shows the admin sign-in, and your `ADMIN_EMAIL`/`ADMIN_PASSWORD` work.

---

## 7. The web app (Cloudflare Pages)

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → `liftmason/best-gym-app`. Use these settings:
   - Production branch: `main`
   - Root directory: `app`
   - Build command: `npm ci && npx expo export --platform web`
   - Build output directory: `dist`
   - Environment variables:
     - `EXPO_PUBLIC_API_URL` = `https://api.liftmason.com`
     - `EXPO_PUBLIC_SENTRY_DSN` = the "liftmason-app" project's DSN
     - `NODE_VERSION` = `22`
2. **Custom domains → Set up a custom domain** → `app.liftmason.com`.

**Check, on a computer:**
1. `https://app.liftmason.com` shows the sign-in page.
2. Sign up as a new coach with your own email, then invite an athlete (a second email of yours).
3. Open the invite link, and join.
4. Log a session as the athlete, and see it on the coach's Today screen.
5. Try `https://app.liftmason.com/privacy`, `/terms` and `/delete-account`.

**Check, on phones.** Athletes will train from a phone's browser, and the local training database has only been tested in desktop Chrome, so do this on **an iPhone in Safari** and **an Android phone in Chrome** before inviting anyone:
1. Sign in as the athlete. The week appears, and the sync pill says **Synced**.
2. Start a session, then switch on airplane mode **without closing the page**. Log the rest of the session and finish it. The pill says **Offline · N waiting**.
3. Switch airplane mode off. The pill goes to **Synced**, and the coach sees the whole session.
4. Close the tab and open the app again. The session is still there.
5. With the connection on, pick a form video and send it; the coach can play it.

If anything here fails, stop and send Steven what you saw before going further.

---

## 8. The hourly job

Render has no free cron jobs, so GitHub calls the API every hour instead (`.github/workflows/cron.yml`). The job sends coaches' alerts and 7am digest, and cleans up old form videos.

1. GitHub → `liftmason/best-gym-app` → **Settings → Secrets and variables → Actions → New repository secret**: name `CRON_TOKEN`, with the same value as on Render (step 6).
2. **Actions → Hourly jobs → Run workflow**, to try it now.

**Check:**
- The run is green, and its log ends with a line like `{"expired":0,"abandoned":0,"digests":0,"failed":[]}`.
- Render → `gymtrainer` → **Logs** shows a `POST /api/v1/ops/cron` answered with 200.

A red run means a step failed. The log names it, and Sentry has the error. GitHub may start hourly runs 10–30 minutes late, which is fine. GitHub also switches the schedule off after 60 days with no activity on the repository; the Actions tab then shows a button to switch it back on.

---

## 9. Legal pages (before anyone outside the test group signs up)

The privacy policy and terms are drafts in `app/src/legal/texts.ts`, shown at `/privacy` and `/terms` with a "Draft" notice. Testing with people you know can start while they're drafts.

1. Have them read by someone qualified for where you operate.
2. Fill in everything in [brackets]. That covers the legal name and address, the contact email, the **minimum age** (weightlifting coaches often train teenagers), the plans and refunds, and the governing law.
3. Set `DRAFT = false` and `UPDATED` to the date, then push. Cloudflare redeploys the web app by itself.

---

## 10. Inviting testers, and after the first deploy

**Tell testers** what the web app can't do yet (below). Also tell them that **the first visit after a quiet spell takes about a minute**: the free server sleeps after 15 minutes with no visitors. The sync pill waits, and nothing is lost.

**What the web app can't do yet.** These go away with the store apps (Part 2).
- **No notifications.** Nobody gets a push when a coach publishes a week or sends a message; they see it next time they open the app.
- **Offline works only while the page is open.** Training data is kept on the phone, and a whole session logs and saves with no signal. But the page itself isn't stored for offline use, so opening the app for the first time that day with no signal doesn't work. **Open it before going somewhere with no signal.**
- **Form videos need a connection** while they're sent. The phone apps queue them for later; the web app can't keep the file.
- **One tab at a time.** A second tab says the app is open in another tab.
- **iPhones: add it to the home screen** (Share → Add to Home Screen). Safari clears a website's stored data after seven days of use without a visit, which would lose anything not yet synced; a home-screen app keeps it.

**After the first deploy:**
- **The rate-limit check:** with `LOG_CLIENT_IP=1` set:
  1. Sign in once from a phone on mobile data.
  2. In Render → `gymtrainer` → **Logs**, find the `client-ip check:` line and send it to Steven. It shows whether sign-in limits count each visitor separately behind Render's proxy.
  3. Then remove `LOG_CLIENT_IP`.
- **Watch Sentry** for the first week.
- **Put a reminder in the diary for day 25 after step 6.** Decide then whether to upgrade: the free database is deleted on day 30.
- The free database has **no backups**. The restore drill waits for the upgrade.
- **Ongoing running:** `docs/OPERATIONS.md`.

---

## 11. Steven's old Render account

The first trial ran on Steven's free Render account. It was switched off on 26 September, and its database was empty, so nothing moves. To finish:
1. **Steven** deletes the `gymtrainer` service and `gymtrainer-db` in his Render account.
2. **Steven** removes Render's access to the repository: Render → Account settings → GitHub, or github.com/settings/installations.
3. **You** (or Claude Code, if you ask) delete the stale deployment environments on GitHub: the repository → **Settings → Environments** → `main - gymtrainer` and `main - gymtrainer-db`.

---

# Upgrading to paid (going public)

Upgrade when **any one** of these is true:
- testing passes day 25 of the free database;
- the one-minute wake-ups get in the way;
- anyone outside the test group signs up.

It costs about $14 a month, and everything stays in the same Render account:
1. **Render → `gymtrainer-db` → Upgrade** to Basic (256 MB). The data is kept.
2. **Render → `gymtrainer` → Upgrade** to Starter.
3. **The blueprint:** ask Steven or Claude Code to reverse the free-tier changes listed at the top of `render.yaml`:
   - the paid plans;
   - migrations back in a pre-deploy step, with 3 workers;
   - the `gymtrainer-cron` service back.

   Render applies the blueprint when it reaches `main`.
4. **Switch the GitHub job off:** delete the `CRON_TOKEN` repository secret and the `CRON_TOKEN` setting on Render. The workflow then does nothing, and the endpoint answers 404.
5. **Do the backup restore drill** (`docs/OPERATIONS.md`, "Backups"), then every few months.
6. **Only if Steven needs his own logins:** Render → upgrade the workspace to Pro ($25 a month), then invite him. Sentry → Team plan ($26 a month).
7. **Before opening Apple or Google Play, decide whether a business will own the accounts.**
   - If it will, move the accounts to it first:
     - point `ops@` at the business;
     - make the business the owner in Cloudflare, GitHub, Expo and Resend;
     - for Render, which can't move services between accounts: create the services from `render.yaml` in the business's Render account, then restore the database from a dump (`docs/OPERATIONS.md`, "Backups").
   - Google Play personal accounts can never become business accounts, and an individual Apple account shows your legal name as the seller.

**Check:** `https://api.liftmason.com/healthz` answers straight away after an hour of quiet, and the next hour's Render cron run logs its `cron:` line.

---

# Part 2: the stores (after web testing)

**Upgrade to paid first** (the section above). This part also uses Render's shell, which free services don't have.

## 1. Accounts

Open these in the name you decided on in "Upgrading to paid", step 7.

**If a business owns the accounts:**
1. **A D-U-N-S number** for the business, from Dun & Bradstreet. It's free and takes up to two weeks. Apple and Google both use it to verify an organisation.
2. **Apple Developer Program, as an organisation** (developer.apple.com → Account → Enroll).
   - You'll need the D-U-N-S number, the business's legal name, and a website (`liftmason.com` works).
   - Once approved, invite Steven's Apple ID as an Admin or "App Manager".
3. **Google Play Console, as an organisation** (play.google.com/console).

**If you stay personal:**
- Apple: enroll as an individual. Your legal name shows as the seller, and Steven can use App Store Connect but can't manage signing certificates.
- Google Play: a personal account. **It can never become an organisation account, and new personal accounts must run a closed test with 12 or more testers for 14 days before they can publish.**

Steven is already an Admin of the Expo team (Part 1, step 4).

---

## 2. The icon

The icon is a placeholder: a white "L" on the brand blue, made by `app/scripts/placeholder-icons.py`. **Replace it before submitting to the stores.** (The web app's favicon comes from the same files, so replacing it earlier is fine.)

A designer needs to supply:
- `icon.png` (1024 × 1024, no transparency);
- Android's adaptive icon layers (`android-icon-foreground.png`, `-background.png` and `-monochrome.png`, 512 × 512, the mark inside the middle two thirds);
- `splash-icon.png`;
- `favicon.png` (48 × 48).

They go in `app/assets/images/`, replacing the files there.

---

## 3. The reviewers' account

Apple's reviewers need to sign in and see real screens.

1. On Render, set `REVIEW_ACCOUNT_EMAIL` (an address for the store reviewers, e.g. `review@liftmason.com`; it needn't receive mail) and `REVIEW_ACCOUNT_CODE` (six digits of your choosing, e.g. `246810`).
2. In Render → `gymtrainer` → **Shell**, build the reviewers' gym:

       python manage.py seed_review

---

## 4. Phone apps: test builds

From `app/`, signed in to the Expo team (`npx eas-cli@latest login`):

1. **The app's crash reporting:** `npx eas-cli@latest env:create --name EXPO_PUBLIC_SENTRY_DSN --value <the app project's DSN> --environment production --environment preview`.
2. **Push notifications:**
   - Android: create a Firebase project, add an Android app `com.liftmason.app`, and download its service-account key. Upload the key with `npx eas-cli@latest credentials` (Android → Google Service Account → FCM V1).
   - iOS push is set up by EAS during the first iOS build.
3. **Test builds:** `npx eas-cli@latest build --profile preview --platform all`.
   - EAS asks to create the iOS certificates and the Android keystore: let it (it keeps them).
   - Android testers install from the link it gives.
   - iOS testers are added with `npx eas-cli@latest device:create` first, or use TestFlight (step 5).
4. **The offline check on a real phone:** `docs/OFFLINE_CHECKLIST.md`, including closing the app completely while offline, which the web app can't do.

   The same check is automated for Android emulators in `app/.maestro` (see its README; it needs a development build: `--profile development`).

---

## 5. Submitting

`docs/STORE_LISTING.md` has every text, answer and screenshot to use.

**Apple** (App Store Connect):
1. **My Apps → New App.** Choose iOS, name "Liftmason", bundle id `com.liftmason.app`. Fill in the listing, the privacy answers ("App Privacy") and the age rating from `STORE_LISTING.md`.
2. **Build and upload:** `npx eas-cli@latest build --profile production --platform ios`, then `npx eas-cli@latest submit --platform ios`. The first submit asks for the App Store Connect app, and EAS remembers it.
3. **TestFlight:** add internal testers and try the build on real iPhones.
4. **App Review Information:** add the review account, from `STORE_LISTING.md`, "Notes for Apple's reviewers". Run `python manage.py seed_review --reset` on Render just before submitting, so the dates are fresh.
5. **Submit for review.** It usually takes a day or two.

**Google** (Play Console):
1. **Create app:** name "Liftmason", free. Fill in the store listing, the **Data safety** form, the content rating, and the account-deletion URL (`https://app.liftmason.com/delete-account`), all from `STORE_LISTING.md`.
2. **Build and upload:** `npx eas-cli@latest build --profile production --platform android`, then `npx eas-cli@latest submit --platform android`. This lands on the **internal testing** track as a draft (`eas.json`), and the first upload may need to be done by hand in the Console.
3. Test it with internal testers, then **promote to production**.

---

# Billing (when you want to charge)

Billing is built but off, so everything is free until it's turned on. When plans and prices are decided:
1. In Stripe, create a product and a monthly price for each plan.
2. In the admin, create the plans (limits, and the Stripe price id; tick "public"), and set `DEFAULT_PLAN`.
3. In Stripe, add a webhook to `https://api.liftmason.com/api/v1/billing/webhook` with the events listed in `docs/OPERATIONS.md`, "Billing (Stripe)".
4. On Render, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `BILLING_ENABLED=1`.

Gyms subscribe on the web, in Settings → Plan (it never shows in the phone apps; Apple doesn't allow that). Also fill in the terms' "Subscriptions" section.

---

## Checklist

**Part 1, the test run:**
- [ ] `liftmason` GitHub organization; repository moved; Steven an owner; remotes updated
- [ ] Cloudflare account; `liftmason.com` bought with auto-renew; `ops@` forwarding; Steven an Administrator; `liftmason.com` redirects to the app
- [ ] Resend domain verified, DMARC added, API key; Steven invited if allowed
- [ ] Sentry projects and alert emails; Steven an Admin in Expo
- [ ] Two-factor sign-in and recovery codes on every account
- [ ] R2 bucket and token
- [ ] Render blueprint deployed **on the day testing starts**; settings filled in; `api.liftmason.com` works; CORS set
- [ ] Cloudflare Pages deployed; `app.liftmason.com` works; a coach-and-athlete run-through done on a computer
- [ ] The phone check done on an iPhone (Safari) and an Android phone (Chrome)
- [ ] `CRON_TOKEN` secret on GitHub; a manual "Hourly jobs" run is green
- [ ] Testers told about the one-minute wake-up and what the web app can't do yet
- [ ] `LOG_CLIENT_IP` check done and removed
- [ ] Day-25 reminder in the diary
- [ ] Steven's old Render service, database and GitHub access removed; stale GitHub environments deleted
- [ ] Privacy policy and terms finished; `DRAFT = false` (before anyone outside the test group)

**Upgrading to paid:**
- [ ] Render database on Basic and API on Starter
- [ ] `render.yaml` back on paid plans with the cron service; `CRON_TOKEN` removed from Render and GitHub
- [ ] Backup restore drill done
- [ ] Decided whether a business owns the accounts, before opening Apple or Google

**Part 2, the stores:**
- [ ] D-U-N-S number (for an organisation); Apple Developer; Google Play
- [ ] Designed icon in place
- [ ] Review account settings set; `seed_review` run
- [ ] Sentry DSN set in EAS; Firebase key uploaded for Android push
- [ ] Preview builds tested on real phones, including `docs/OFFLINE_CHECKLIST.md`
- [ ] App Store: listing, privacy answers, review account, submitted
- [ ] Google Play: listing, data safety, deletion URL, internal test, production
