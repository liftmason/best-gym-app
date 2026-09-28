# Launching Liftmason: the runbook

*For the owner (S8b). Written 28 September 2026 at the end of S8a (`docs/plans/S8_LAUNCH.md`). Split the same day into a web launch and a later store launch, when the owner chose to launch on the web first (`docs/EXPO_MIGRATION.md`, "Decided at launch").*

**Where things stand.** The app is built and tested: the backend, the web app, and the iOS and Android apps. Nothing is deployed and nothing is in a store.

**The plan.** Launch in two parts:
- **Part 1, the web app (now).** Deploy the backend and the web app at `app.liftmason.com`, and test with real coaches and athletes. Coaches and athletes both use it in a browser, on a computer or a phone.
- **Part 2, the stores (after testing).** Apple and Google accounts, a designed icon, phone builds, and submission. Nothing in Part 1 needs to be redone for it.

**How to use it.** Each step says:
- what to do;
- what it costs;
- what to paste where;
- how to check it worked.

Settings you enter are marked like `THIS`. Keep them in a password manager as you go.

**Get help:** anything in `code` is either a setting name or a command to run. Steven (or Claude Code) can run the commands, but the accounts must be the business's own.

---

## 0. Costs and time

| What | Cost | Time to set up | When |
|---|---|---|---|
| Domain `liftmason.com` | about $10 a year | minutes | Part 1 |
| Render: API ($7) + cron job (about $1) + database ($6), in Virginia | about $14 a month | an hour | Part 1 |
| Cloudflare: website, DNS and video storage | free at launch | an hour | Part 1 |
| Resend: email | free up to 3,000 emails a month | 30 minutes | Part 1 |
| Sentry: crash reports | free tier | 20 minutes | Part 1 |
| Apple Developer Program (organisation) | $99 a year | **days to weeks** (needs a D-U-N-S number) | Part 2 |
| Google Play Console (organisation) | $25 once | a few days (identity and D-U-N-S checks) | Part 2 |
| Expo (EAS builds) | free tier (limited builds a month), or $19 a month for faster builds | exists | Part 2 |
| Stripe: gym subscriptions | a fee per payment, when billing is turned on | later | When you charge |

**Part 1 costs about $14 a month plus the domain.**

If you already know you'll go to the stores, **request the D-U-N-S number now** (Part 2, step 1). It's free, it's the slowest step, and it can run while you test.

---

# Part 1: the web app

## 1. Accounts

1. **Render** (render.com): a team account for the business, with a card.
2. **Cloudflare** (cloudflare.com): free.
3. **Resend** (resend.com): free.
4. **Sentry** (sentry.io): free. Create two projects: "liftmason-api" (Python, Django) and "liftmason-app" (React Native; it covers the web app too).

---

## 2. The domain and DNS

1. **Buy `liftmason.com`.** Cloudflare Registrar sells domains at cost, which keeps the DNS in one place. Also buy `liftmason.app` if you want to keep it from others; it isn't used.
2. **Addresses** (Cloudflare → DNS). Keep the app and the API on this one domain: the web app's sign-in depends on it.

| Name | Points to | Set up in |
|---|---|---|
| `app.liftmason.com` | the web app | step 5 (Cloudflare Pages adds it) |
| `api.liftmason.com` | the backend | step 4 (Render gives a `CNAME` target) |
| `liftmason.com` | redirects to `https://app.liftmason.com` | Cloudflare → Rules → Redirect Rules |

3. **Email records** come from Resend in step 3.

---

## 3. Email (Resend)

1. Resend → **Domains → Add domain** → `liftmason.com`. Add the DNS records it shows (SPF, DKIM) in Cloudflare, then click **Verify**.
2. **Add a DMARC record** in Cloudflare. It's a `TXT` record named `_dmarc`, with the value `v=DMARC1; p=none; rua=mailto:[your email]`. It stops sign-in codes from landing in spam.
3. Resend → **API Keys → Create** (sending access). This is `EMAIL_API_KEY`.

**Check:** once the backend runs (step 4), sign up as a new coach with a real address. The code should arrive within a minute, and not in spam. mail-tester.com scores a message if you send it one.

---

## 4. The backend (Render)

1. **Create a bucket for form videos:** Cloudflare → **R2 → Create bucket** `gymtrainer-videos`, with public access **off**. Then **Manage API tokens → Create**, with "Object Read & Write" on that bucket. Note:
   - the access key id (`STORAGE_ACCESS_KEY`);
   - the secret (`STORAGE_SECRET`);
   - the S3 endpoint (`STORAGE_ENDPOINT`).
2. **Create the services:** Render → **New → Blueprint** → connect GitHub and pick the repository `spearw/best-gym-app`.
   - Render reads `render.yaml`. It creates the API (`gymtrainer`), the hourly job (`gymtrainer-cron`) and the database (`gymtrainer-db`), all in Virginia.
3. **Fill in the settings** it asks for. The shared group and both services show the same names:

| Setting | Value |
|---|---|
| `SITE_URL` | `https://app.liftmason.com` |
| `WEB_APP_ORIGINS` | `https://app.liftmason.com` |
| `ALLOWED_HOSTS` (API) | `api.liftmason.com` |
| `CSRF_TRUSTED_ORIGINS` (API) | `https://api.liftmason.com` |
| `EMAIL_PROVIDER` | `resend` |
| `EMAIL_API_KEY` | from step 3 |
| `DEFAULT_FROM_EMAIL` | `Liftmason <no-reply@liftmason.com>` |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET` | from step 4.1 (`STORAGE_BUCKET` = `gymtrainer-videos`) |
| `SENTRY_DSN` | the "liftmason-api" project's DSN |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` (API) | the admin sign-in: your email, and a long password |
| `ADMIN_PATH` (API) | something unguessable, e.g. `manage-7f3k2/` |
| `LOG_CLIENT_IP` (API) | `1` for now; see step 8 |

Leave these blank:
- `REVIEW_ACCOUNT_EMAIL`, `REVIEW_ACCOUNT_CODE`: only the store reviewers need them (Part 2). Left blank, no fixed sign-in code exists.
- `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS`: not used at launch.
- `EXPO_ACCESS_TOKEN`: only if the Expo project turns on "enhanced push security".
- `BILLING_ENABLED` and the Stripe keys: see "Billing" at the end.
- `APP_NAME`.

4. **Deploy.** The first deploy migrates the database and creates the admin account.
5. **Add the API's own address:** Render → `gymtrainer` → **Settings → Custom Domains** → `api.liftmason.com`. Add the `CNAME` it gives you in Cloudflare, with the proxy switched **off** (grey cloud).
6. **Allow uploads from the web app.** Open Render → `gymtrainer` → **Shell** and run:

       python manage.py storage_setup --origin https://app.liftmason.com

**Check:**
- `https://api.liftmason.com/healthz` answers `{"status": "ok"}`.
- `https://api.liftmason.com/<ADMIN_PATH>` shows the admin sign-in, and your `ADMIN_EMAIL`/`ADMIN_PASSWORD` work.

---

## 5. The web app (Cloudflare Pages)

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → the same repository. Use these settings:
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

## 6. Legal pages (before anyone outside the test group signs up)

The privacy policy and terms are drafts in `app/src/legal/texts.ts`, shown at `/privacy` and `/terms` with a "Draft" notice. Testing with people you know can start while they're drafts.

1. Have them read by someone qualified for where the business operates.
2. Fill in everything in [brackets]. That covers the business's legal name and address, the contact email, the **minimum age** (weightlifting coaches often train teenagers), the plans and refunds, and the governing law.
3. Set `DRAFT = false` and `UPDATED` to the date, then push. Cloudflare redeploys the web app by itself.

---

## 7. What the web app can't do yet

Tell your testers these. They go away with the store apps (Part 2).

- **No notifications.** Nobody gets a push when a coach publishes a week or sends a message; they see it next time they open the app.
- **Offline works only while the page is open.** Training data is kept on the phone, and a whole session logs and saves with no signal. But the page itself isn't stored for offline use, so opening the app for the first time that day with no signal doesn't work. **Open it before going somewhere with no signal.**
- **Form videos need a connection** while they're sent. The phone apps queue them for later; the web app can't keep the file.
- **One tab at a time.** A second tab says the app is open in another tab.
- **iPhones: add it to the home screen** (Share → Add to Home Screen). Safari clears a website's stored data after seven days of use without a visit, which would lose anything not yet synced; a home-screen app keeps it.

---

## 8. After the first deploy

- **The rate-limit check:** with `LOG_CLIENT_IP=1` set:
  1. Sign in once from a phone on mobile data.
  2. In Render → `gymtrainer` → **Logs**, find the `client-ip check:` line and send it to Steven. It shows whether sign-in limits count each visitor separately behind Render's proxy.
  3. Then remove `LOG_CLIENT_IP`.
- **A backup restore drill:** once before real users arrive, then every few months (`docs/OPERATIONS.md`, "Backups").
- **Watch Sentry** for the first week.
- **Ongoing running:** `docs/OPERATIONS.md`.

---

# Part 2: the stores (after web testing)

## 1. Accounts

1. **A D-U-N-S number** for the business, from Dun & Bradstreet. It's free, and takes up to two weeks. Apple and Google both use it to verify an organisation. Skip this if the business already has one.
2. **Apple Developer Program, as an organisation** (developer.apple.com → Account → Enroll).
   - You'll need the D-U-N-S number, the business's legal name, and a website (`liftmason.com` from Part 1 works).
   - Once approved, invite Steven's Apple ID as an "App Manager" if he'll handle builds.
3. **Google Play Console, as an organisation** (play.google.com/console).
   - Use an organisation account. **New personal accounts must run a closed test with 12 or more testers for 14 days before they can publish.**
4. **Expo:** the project already exists under `spearws-team` (expo.dev). Add the owner as an admin of that team.

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

**Part 1, the web app:**
- [ ] Render, Cloudflare, Resend, Sentry accounts
- [ ] `liftmason.com` bought; `liftmason.com` redirects to the app
- [ ] Resend domain verified, and DMARC added
- [ ] R2 bucket and token
- [ ] Render blueprint deployed and settings filled in; `api.liftmason.com` works; `storage_setup` run
- [ ] Cloudflare Pages deployed; `app.liftmason.com` works; a coach-and-athlete run-through done on a computer
- [ ] The phone check done on an iPhone (Safari) and an Android phone (Chrome)
- [ ] Testers told what the web app can't do yet
- [ ] `LOG_CLIENT_IP` check done and removed
- [ ] Backup restore drill done
- [ ] Privacy policy and terms finished; `DRAFT = false` (before anyone outside the test group)

**Part 2, the stores:**
- [ ] D-U-N-S number; Apple Developer (organisation); Google Play (organisation); owner added to the Expo team
- [ ] Designed icon in place
- [ ] Review account settings set; `seed_review` run
- [ ] Sentry DSN set in EAS; Firebase key uploaded for Android push
- [ ] Preview builds tested on real phones, including `docs/OFFLINE_CHECKLIST.md`
- [ ] App Store: listing, privacy answers, review account, submitted
- [ ] Google Play: listing, data safety, deletion URL, internal test, production
