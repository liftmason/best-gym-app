# Launching Liftmason: the runbook

*For the owner (S8b). Written 28 September 2026 at the end of S8a (`docs/plans/S8_LAUNCH.md`).*

**Where things stand.** The app is built and tested: the backend, the web app, and the iOS and Android apps. Nothing is deployed and nothing is in a store. This runbook covers everything left, in order:
- the accounts to open;
- the domain and email;
- deploying the backend and the web app;
- building the phone apps and submitting them.

**How to use it.** Each step says:
- what to do;
- what it costs;
- what to paste where;
- how to check it worked.

Settings you enter are marked like `THIS`. Keep them in a password manager as you go.

**Get help:** anything in `code` is either a setting name or a command to run. Steven (or Claude Code) can run the commands, but the accounts must be the business's own.

---

## 0. Costs and time

| What | Cost | Time to set up |
|---|---|---|
| Domain `liftmason.com` | about $10 a year | minutes |
| Apple Developer Program (organisation) | $99 a year | **days to weeks** (needs a D-U-N-S number) |
| Google Play Console (organisation) | $25 once | a few days (identity and D-U-N-S checks) |
| Render: API ($7) + cron job (about $1) + database ($6), in Virginia | about $14 a month | an hour |
| Cloudflare: website, DNS and video storage | free at launch | an hour |
| Resend: email | free up to 3,000 emails a month | 30 minutes |
| Sentry: crash reports | free tier | 20 minutes |
| Expo (EAS builds) | free tier (limited builds a month), or $19 a month for faster builds | exists |
| Stripe: gym subscriptions | a fee per payment, when billing is turned on | later |

**Start Apple first.** It's the slowest step, and everything else can happen while you wait.

---

## 1. Accounts (start now)

1. **A D-U-N-S number** for the business, from Dun & Bradstreet. It's free, and takes up to two weeks. Apple and Google both use it to verify an organisation. Skip this if the business already has one.
2. **Apple Developer Program, as an organisation** (developer.apple.com → Account → Enroll).
   - You'll need the D-U-N-S number, the business's legal name, and a website.
   - Once approved, invite Steven's Apple ID as an "App Manager" if he'll handle builds.
3. **Google Play Console, as an organisation** (play.google.com/console).
   - Use an organisation account. **New personal accounts must run a closed test with 12 or more testers for 14 days before they can publish.**
4. **Render** (render.com): a team account for the business, with a card.
5. **Cloudflare** (cloudflare.com): free.
6. **Resend** (resend.com): free.
7. **Sentry** (sentry.io): free. Create two projects: "liftmason-api" (Python, Django) and "liftmason-app" (React Native).
8. **Expo:** the project already exists under `spearws-team` (expo.dev). Add the owner as an admin of that team.

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
| `REVIEW_ACCOUNT_EMAIL` | an address for the store reviewers, e.g. `review@liftmason.com` (it needn't receive mail) |
| `REVIEW_ACCOUNT_CODE` | six digits of your choosing, e.g. `246810` |
| `LOG_CLIENT_IP` (API) | `1` for now; see step 11 |

Leave these blank:
- `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS`: not used at launch.
- `BILLING_ENABLED` and the Stripe keys: see step 10.
- `EXPO_ACCESS_TOKEN`, `APP_NAME`.

4. **Deploy.** The first deploy migrates the database and creates the admin account.
5. **Add the API's own address:** Render → `gymtrainer` → **Settings → Custom Domains** → `api.liftmason.com`. Add the `CNAME` it gives you in Cloudflare, with the proxy switched **off** (grey cloud).
6. **Allow uploads from the web app.** Open Render → `gymtrainer` → **Shell** and run:

       python manage.py storage_setup --origin https://app.liftmason.com

7. **Build the reviewers' gym**, in the same shell:

       python manage.py seed_review

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

**Check:**
1. `https://app.liftmason.com` shows the sign-in page.
2. Sign up as a new coach with your own email, then invite an athlete (a second email of yours).
3. Open the invite link, and join.
4. Log a session as the athlete, and see it on the coach's Today screen.
5. Try `https://app.liftmason.com/privacy`, `/terms` and `/delete-account`.

---

## 6. Legal pages (before anyone real signs up)

The privacy policy and terms are drafts in `app/src/legal/texts.ts`, shown at `/privacy` and `/terms` with a "Draft" notice.

1. Have them read by someone qualified for where the business operates.
2. Fill in everything in [brackets]. That covers the business's legal name and address, the contact email, the **minimum age** (weightlifting coaches often train teenagers), the plans and refunds, and the governing law.
3. Set `DRAFT = false` and `UPDATED` to the date, then push. Cloudflare redeploys the web app by itself; the phone apps pick the change up in their next build.

---

## 7. The icon

The icon is a placeholder: a white "L" on the brand blue, made by `app/scripts/placeholder-icons.py`. **Replace it before submitting to the stores.**

A designer needs to supply:
- `icon.png` (1024 × 1024, no transparency);
- Android's adaptive icon layers (`android-icon-foreground.png`, `-background.png` and `-monochrome.png`, 512 × 512, the mark inside the middle two thirds);
- `splash-icon.png`;
- `favicon.png` (48 × 48).

They go in `app/assets/images/`, replacing the files there.

---

## 8. Phone apps: test builds

From `app/`, signed in to the Expo team (`npx eas-cli@latest login`):

1. **The app's crash reporting:** `npx eas-cli@latest env:create --name EXPO_PUBLIC_SENTRY_DSN --value <the app project's DSN> --environment production --environment preview`.
2. **Android push notifications:** create a Firebase project, add an Android app `com.liftmason.app`, and download its service-account key. Upload the key with `npx eas-cli@latest credentials` (Android → Google Service Account → FCM V1). iOS push is set up by EAS during the first iOS build.
3. **Test builds:** `npx eas-cli@latest build --profile preview --platform all`.
   - EAS asks to create the iOS certificates and the Android keystore: let it (it keeps them).
   - Android testers install from the link it gives.
   - iOS testers are added with `npx eas-cli@latest device:create` first, or use TestFlight (step 9).
4. **The offline check on a real phone:**
   1. Sign in as an athlete.
   2. Switch on airplane mode and log a whole session.
   3. Reconnect, and see it arrive on the coach's side.

   The same check is automated for Android emulators in `app/.maestro` (see its README; it needs a development build: `--profile development`).

---

## 9. The stores

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

## 10. Billing (when you want to charge)

Billing is built but off, so everything is free until it's turned on. When plans and prices are decided:
1. In Stripe, create a product and a monthly price for each plan.
2. In the admin, create the plans (limits, and the Stripe price id; tick "public"), and set `DEFAULT_PLAN`.
3. In Stripe, add a webhook to `https://api.liftmason.com/api/v1/billing/webhook` with the events listed in `docs/OPERATIONS.md`, "Billing (Stripe)".
4. On Render, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `BILLING_ENABLED=1`.

Gyms subscribe on the web, in Settings → Plan (it never shows in the phone apps; Apple doesn't allow that). Also fill in the terms' "Subscriptions" section.

---

## 11. After the first deploy

- **The rate-limit check:** with `LOG_CLIENT_IP=1` set:
  1. Sign in once from a phone on mobile data.
  2. In Render → `gymtrainer` → **Logs**, find the `client-ip check:` line and send it to Steven. It shows whether sign-in limits count each visitor separately behind Render's proxy.
  3. Then remove `LOG_CLIENT_IP`.
- **A backup restore drill:** once before real users arrive, then every few months (`docs/OPERATIONS.md`, "Backups").
- **Watch Sentry** for the first week.
- **Ongoing running:** `docs/OPERATIONS.md`.

---

## Checklist

**Accounts and services:**
- [ ] D-U-N-S number; Apple Developer (organisation); Google Play (organisation)
- [ ] Render, Cloudflare, Resend, Sentry accounts; owner added to the Expo team
- [ ] `liftmason.com` bought; `liftmason.com` redirects to the app
- [ ] Resend domain verified, and DMARC added
- [ ] R2 bucket and token

**Deploy:**
- [ ] Render blueprint deployed and settings filled in; `api.liftmason.com` works; `storage_setup` and `seed_review` run
- [ ] Cloudflare Pages deployed; `app.liftmason.com` works; a coach-and-athlete run-through done

**Before submitting:**
- [ ] Privacy policy and terms finished; `DRAFT = false`
- [ ] Designed icon in place
- [ ] Sentry DSNs set (backend, web, EAS)
- [ ] Firebase key uploaded for Android push
- [ ] Preview builds tested on real phones, including the airplane-mode session
- [ ] App Store: listing, privacy answers, review account, submitted
- [ ] Google Play: listing, data safety, deletion URL, internal test, production

**Afterwards:**
- [ ] `LOG_CLIENT_IP` check done and removed
- [ ] Backup restore drill done
