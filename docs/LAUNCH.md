# Launching Liftmason: the runbook

*For the owner (S8b). Written 28 September 2026 at the end of S8a (`docs/plans/S8_LAUNCH.md`). The same day, the owner chose a free web test run in their own name, first on Render's own addresses with no domain (`docs/plans/S8B_TEST_RUN.md`).*

**Where things stand.** The app is built and tested: the backend, the web app, and the iOS and Android apps. The repository is `liftmason/best-gym-app`. Nothing is deployed and nothing is in a store.

**The plan, in stages:**
- **Part 1, the test run (now), free.** The API, the web app and the database on Render, at Render's own `….onrender.com` addresses. Everyone signs in with one shared code; no email is sent.
- **Part 1b, the domain (when you're ready).** `liftmason.com` with email, so sign-in codes arrive by email and the addresses are permanent.
- **Upgrading to paid (going public).** An upgrade in place, about $14 a month.
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
| GitHub organization `liftmason` | free | done | Part 1 |
| Render: API, web app and database | **free during testing**; about $14 a month when going public (API $7, database $6, hourly job about $1; the web app stays free) | an hour | Part 1 |
| Sentry: crash reports | free (one user) | 20 minutes | optional in Part 1 |
| Domain `liftmason.com` | about $10 a year | minutes | Part 1b |
| Cloudflare: DNS, email forwarding, video storage | free | an hour | Part 1b |
| Resend: email | free up to 3,000 emails a month | 30 minutes | Part 1b |
| Render Pro | $25 a month | minutes | Only if Steven needs his own Render login |
| Sentry Team | $26 a month | minutes | Only if Steven needs his own Sentry login |
| Apple Developer Program | $99 a year | **days to weeks** (an organisation needs a D-U-N-S number) | Part 2 |
| Google Play Console | $25 once | a few days | Part 2 |
| Expo (EAS builds) | free tier (limited builds a month), or $19 a month for faster builds | exists | Part 2 |
| Stripe: gym subscriptions | a fee per payment, when billing is turned on | later | When you charge |

**Part 1 costs nothing.**

**Who has access.** The accounts are yours. Steven is an admin wherever that's free:

| Service | Steven |
|---|---|
| GitHub (`liftmason` organization) | Owner |
| Expo (`spearws-team`) | Admin |
| Cloudflare (Part 1b) | Administrator |
| Resend (Part 1b) | Admin, if the free plan allows a second member |
| Render | No login during testing. Merging to `main` deploys. |
| Sentry | No login. Alert emails go to both of you. |

**On every account:**
- two-factor sign-in, preferably a passkey or an authenticator app, never SMS;
- recovery codes in the password manager.

---

# Part 1: the test run on Render's addresses

## 1. GitHub (done)

The repository is in the `liftmason` organization. Two things are left:
- Make Steven an **Owner**: github.com/orgs/liftmason/people → Steven → **Change role → Owner**.
- On each computer with a checkout: `git remote set-url origin git@github.com:liftmason/best-gym-app.git`

---

## 2. Render: the API, the web app and the database

**Do this on the day testing starts.** Render's free database is deleted 30 days after it's created, unless it's upgraded (see "Upgrading to paid").

1. **Open a Render account** (render.com, the free Hobby plan; no card needed). Use your own email for now; move it to `ops@liftmason.com` in Part 1b. Turn on two-factor sign-in.
2. **Create the services:** Render → **New → Blueprint** → connect GitHub, allow access to the `liftmason` organization, and pick `best-gym-app`. Render reads `render.yaml` and creates, all free:
   - `gymtrainer`: the API, in Virginia;
   - `gymtrainer-web`: the web app, on Render's CDN;
   - `gymtrainer-db`: the database, in Virginia.
3. **Fill in the settings** it asks for. Render's addresses are `https://<service name>.onrender.com`, so the API is normally `https://gymtrainer.onrender.com` and the web app `https://gymtrainer-web.onrender.com`. If a name is taken, Render adds a few characters: step 5 checks.

**On the API (`gymtrainer`):**

| Setting | Value |
|---|---|
| `SITE_URL` | the web app's address, `https://gymtrainer-web.onrender.com` (invite links use it) |
| `WEB_APP_ORIGINS` | the same address |
| `EMAIL_PROVIDER` | `console` (no email is sent; see `TEST_SIGNIN_CODE`) |
| `TEST_SIGNIN_CODE` | six digits of your choosing, not `123456`. Everyone signs in with it. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the admin sign-in: your email, and a long password (12 characters or more) |
| `ADMIN_PATH` | something unguessable, e.g. `manage-7f3k2/` |
| `CRON_TOKEN` | a long random value for the hourly job (step 4). Make one with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `LOG_CLIENT_IP` | `1` for now; see step 7 |
| `SENTRY_DSN` | optional: the "liftmason-api" project's DSN, if you've made one |

`ACCESS_TOKEN_TTL_MINUTES` is already set to a week by the blueprint.

Leave everything else blank:
- `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`: Render's own address is allowed automatically.
- `EMAIL_API_KEY` and `DEFAULT_FROM_EMAIL`: Part 1b.
- `STORAGE_*`: form videos stay off until there's an R2 bucket (Part 1b).
- `REVIEW_ACCOUNT_EMAIL`, `REVIEW_ACCOUNT_CODE`, `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS`, `EXPO_ACCESS_TOKEN`, `APP_NAME`.
- `BILLING_ENABLED` and the Stripe keys: see "Billing" at the end.

**On the web app (`gymtrainer-web`):**

| Setting | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | the API's address, `https://gymtrainer.onrender.com` |
| `EXPO_PUBLIC_SENTRY_DSN` | optional: the "liftmason-app" project's DSN |

4. **Deploy.** The API's first start migrates the database and creates your admin account. The web app builds the Expo export, which takes a few minutes.
5. **Check the addresses.** Render → each service shows its real address at the top.
   - If the API's differs from what you entered, fix `EXPO_PUBLIC_API_URL` on the web app.
   - If the web app's differs, fix `SITE_URL` and `WEB_APP_ORIGINS` on the API.
   - After changing `EXPO_PUBLIC_API_URL`, redeploy the web app with **Manual Deploy → Clear build cache & deploy**: the address is built into the app.

**Check:**
- `<API address>/healthz` answers `{"status": "ok"}`. The first request after a quiet spell takes about a minute while the free service wakes up.
- `<API address>/<ADMIN_PATH>` shows the admin sign-in, and your `ADMIN_EMAIL`/`ADMIN_PASSWORD` work.
- The web app's address shows the sign-in page.

---

## 3. Try it yourself

1. Open the web app. Enter your email, then `TEST_SIGNIN_CODE`. A new email is offered coach sign-up: give your name and your gym's name.
2. **Train as your own athlete** (optional): roster → **Invite athlete** → leave the email blank → **Copy**. Open the link in the same browser tab: you join as your own athlete. Switch roles with **More → Switch to Training** and **Profile → Switch to Coaching**.
3. Program a week on the board, publish it, and log a session in training mode. The coach's Today screen shows it.
4. Try `/privacy`, `/terms` and `/delete-account` on the web app's address.

**Check, on phones.** Athletes will train from a phone's browser, and the local training database has only been tested in desktop Chrome, so do this on **an iPhone in Safari** and **an Android phone in Chrome** before inviting anyone:
1. Sign in as an athlete. The week appears, and the sync pill says **Synced**.
2. Start a session, then switch on airplane mode **without closing the page**. Log the rest of the session and finish it. The pill says **Offline · N waiting**.
3. Switch airplane mode off. The pill goes to **Synced**, and the coach sees the whole session.
4. Close the tab and open the web app again. You're still signed in, and the session is still there.

If anything here fails, stop and send Steven what you saw before going further.

---

## 4. The hourly job

Render has no free cron jobs, so GitHub calls the API every hour instead (`.github/workflows/cron.yml`). The job sends coaches' alerts and 7am digest, and cleans up.

1. GitHub → `liftmason/best-gym-app` → **Settings → Secrets and variables → Actions**:
   - **Secrets → New repository secret:** `CRON_TOKEN`, with the same value as on Render.
   - **Variables → New repository variable:** `API_URL`, the API's address (e.g. `https://gymtrainer.onrender.com`). Without it the job calls `api.liftmason.com`, which doesn't exist yet.
2. **Actions → Hourly jobs → Run workflow**, to try it now.

**Check:**
- The run is green, and its log ends with a line like `{"expired": 0, "abandoned": 0, "digests": 0, "failed": []}`.
- Render → `gymtrainer` → **Logs** shows a `POST /api/v1/ops/cron` answered with 200.

A red run means a step failed. The log names it, and Sentry has the error if it's set up. GitHub may start hourly runs 10–30 minutes late, which is fine. GitHub also switches the schedule off after 60 days with no activity on the repository; the Actions tab then shows a button to switch it back on.

---

## 5. Inviting testers

**Coaches:** send them the web app's address and `TEST_SIGNIN_CODE`. They sign up themselves.

**Athletes:** their coach invites each one. Roster → **Invite athlete**, **leave the email blank** (no email is sent during the test run), then **Copy** or **Share** the link and send it by text. Each link works once, for 14 days. The athlete opens it, enters their email and `TEST_SIGNIN_CODE`, then their name, and they're joined to that coach.

**Tell every tester:**
- **The first visit after a quiet spell takes about a minute.** The free server sleeps after 15 minutes with no visitors. The sync pill waits, and nothing is lost.
- **They stay signed in for a week**, then sign in again with the same code.
- **No notifications.** Nobody gets a push when a coach publishes a week or sends a message; they see it next time they open the app.
- **Offline works only while the page is open.** Training data is kept on the phone, and a whole session logs and saves with no signal. But the page itself isn't stored for offline use, so opening the app for the first time that day with no signal doesn't work. **Open it before going somewhere with no signal.**
- **No form videos yet**, until there's video storage (Part 1b).
- **One tab at a time.** A second tab says the app is open in another tab.
- **iPhones: add it to the home screen** (Share → Add to Home Screen). Safari clears a website's stored data after seven days of use without a visit, which would lose anything not yet synced, and the sign-in; a home-screen app keeps both.

**What the shared code means:** anyone who has the web app's address, the code and a tester's email can sign in as that tester. That's fine for a test group with test data. Don't post the address or the code anywhere public.

---

## 6. Legal pages (before anyone outside the test group signs up)

The privacy policy and terms are drafts in `app/src/legal/texts.ts`, shown at `/privacy` and `/terms` with a "Draft" notice. Testing with people you know can start while they're drafts.

1. Have them read by someone qualified for where you operate.
2. Fill in everything in [brackets]. That covers the legal name and address, the contact email, the **minimum age** (weightlifting coaches often train teenagers), the plans and refunds, and the governing law.
3. Set `DRAFT = false` and `UPDATED` to the date, then push. Render redeploys the web app by itself.

---

## 7. After the first deploy

- **The rate-limit check:** with `LOG_CLIENT_IP=1` set:
  1. Sign in once from a phone on mobile data.
  2. In Render → `gymtrainer` → **Logs**, find the `client-ip check:` line and send it to Steven. It shows whether sign-in limits count each visitor separately behind Render's proxy.
  3. Then remove `LOG_CLIENT_IP`.
- **Watch Sentry** for the first week, if it's set up.
- **Put a reminder in the diary for day 25 after step 2.** Decide then whether to upgrade: the free database is deleted on day 30.
- The free database has **no backups**. The restore drill waits for the upgrade.
- **Ongoing running:** `docs/OPERATIONS.md`.

---

## 8. Steven's old Render account

The first trial ran on Steven's free Render account. It was switched off on 26 September, and its database was empty, so nothing moves. To finish:
1. **Steven** deletes the `gymtrainer` service and `gymtrainer-db` in his Render account.
2. **Steven** removes Render's access to the repository: Render → Account settings → GitHub, or github.com/settings/installations.
3. **You** (or Claude Code, if you ask) delete the stale deployment environments on GitHub: the repository → **Settings → Environments** → `main - gymtrainer` and `main - gymtrainer-db`.

---

# Part 1b: the domain (when you're ready)

This gives sign-in codes by email, form videos, and permanent addresses. Nothing in Part 1 is redone.

1. **Cloudflare account and domain.**
   - Sign up at cloudflare.com with your Gmail, and turn on two-factor sign-in.
   - Buy `liftmason.com` (Domain Registration) with **auto-renew on**: every account's password reset will depend on it.
   - Invite Steven: Manage Account → **Members** → **Administrator**.
2. **The ops address:** `liftmason.com` → **Email → Email Routing**. Send `ops@liftmason.com` to your Gmail, and add Steven's address as a second destination if he should see account notices. Move Render's login email to `ops@` (Render → Account settings).
   **Check:** an email to `ops@liftmason.com` arrives in your Gmail.
3. **Addresses:** add custom domains to the Render services, and the `CNAME` records Render gives you in Cloudflare DNS, with the proxy **off** (grey cloud):
   - `gymtrainer-web` → **Settings → Custom Domains** → `app.liftmason.com`;
   - `gymtrainer` → `api.liftmason.com`.
   
   Then add a redirect from `liftmason.com` to `https://app.liftmason.com` (Cloudflare → Rules → Redirect Rules).
4. **Email (Resend):**
   - Open an account with `ops@liftmason.com`, and turn on two-factor sign-in.
   - **Domains → Add domain** → `liftmason.com`. Add its SPF and DKIM records in Cloudflare, then **Verify**.
   - Add DMARC: a `TXT` record named `_dmarc`, value `v=DMARC1; p=none; rua=mailto:ops@liftmason.com`.
   - **API Keys → Create** (sending access). Invite Steven as Admin if the free plan allows it.
5. **Video storage (R2):** Cloudflare → **R2 → Create bucket** `gymtrainer-videos`, public access **off**. Then **Manage API tokens → Create** with "Object Read & Write" on that bucket. Note the access key id, the secret and the S3 endpoint.
   - Allow uploads from the web app: R2 → the bucket → **Settings → CORS policy**, allowing `PUT`, `GET` and `HEAD` from `https://app.liftmason.com`, with any header.
   - Or run `storage_setup --origin https://app.liftmason.com` from `backend/` on a computer with the four `STORAGE_*` values set.
6. **Switch the settings over**, then redeploy the web app with a cleared build cache:

| Where | Setting | New value |
|---|---|---|
| API | `SITE_URL`, `WEB_APP_ORIGINS` | `https://app.liftmason.com` |
| API | `ALLOWED_HOSTS` | `api.liftmason.com` |
| API | `CSRF_TRUSTED_ORIGINS` | `https://api.liftmason.com` |
| API | `EMAIL_PROVIDER` | `resend` |
| API | `EMAIL_API_KEY` | from step 4 |
| API | `DEFAULT_FROM_EMAIL` | `Liftmason <no-reply@liftmason.com>` |
| API | `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET` | from step 5 (`STORAGE_BUCKET` = `gymtrainer-videos`) |
| API | `TEST_SIGNIN_CODE` | **remove**: codes now come by email |
| Web app | `EXPO_PUBLIC_API_URL` | `https://api.liftmason.com` |
| GitHub variable | `API_URL` | remove (the job's default is `https://api.liftmason.com`) |

7. **Blueprint changes (Steven or Claude Code):** now that the web app and the API share `liftmason.com`, the sign-in cookie works:
   - remove `ACCESS_TOKEN_TTL_MINUTES` from the API, back to 15 minutes;
   - remove `EXPO_PUBLIC_WEB_REMEMBER_SIGN_IN` from the web app.

**Check:** sign in on `https://app.liftmason.com` with a real email. The code arrives within a minute, not in spam. You stay signed in across a reload.

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

**Check:** the API's `/healthz` answers straight away after an hour of quiet, and the next hour's Render cron run logs its `cron:` line.

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
- [ ] Steven an Owner of the `liftmason` organization; remotes updated
- [ ] Render account with two-factor sign-in; blueprint deployed **on the day testing starts**
- [ ] API settings filled in (`EMAIL_PROVIDER=console`, `TEST_SIGNIN_CODE`, `SITE_URL`/`WEB_APP_ORIGINS` = the web app's address, admin, `CRON_TOKEN`); web app's `EXPO_PUBLIC_API_URL` = the API's address
- [ ] `/healthz`, the admin and the web app's sign-in page all work
- [ ] Tried it yourself: coach sign-up, a week programmed, a session logged
- [ ] The phone check on an iPhone (Safari) and an Android phone (Chrome)
- [ ] `CRON_TOKEN` secret and `API_URL` variable on GitHub; a manual "Hourly jobs" run is green
- [ ] Testers sent the address and the code, and told what to expect
- [ ] `LOG_CLIENT_IP` check done and removed
- [ ] Day-25 reminder in the diary
- [ ] Steven's old Render service, database and GitHub access removed; stale GitHub environments deleted
- [ ] Privacy policy and terms finished; `DRAFT = false` (before anyone outside the test group)

**Part 1b, the domain:**
- [ ] Cloudflare account; `liftmason.com` with auto-renew; `ops@` forwarding; Steven an Administrator
- [ ] `app.` and `api.liftmason.com` on the Render services; `liftmason.com` redirects to the app
- [ ] Resend domain verified, DMARC added, API key
- [ ] R2 bucket, token and CORS
- [ ] Settings switched over; `TEST_SIGNIN_CODE` removed; blueprint back to 15-minute tokens and no remembered web sign-in
- [ ] A real emailed code arrives, and a reload keeps you signed in

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
