# Store listings: drafts for the App Store and Google Play

*Drafted 28 September 2026 for the owner (S8a). Everything here is a suggestion to review, and items in [brackets] need the owner. `docs/LAUNCH.md` says when each part is needed.*

## The basics

| | App Store | Google Play |
|---|---|---|
| **Name** | Liftmason | Liftmason |
| **Subtitle / short description** | Weightlifting coaching (30 characters at most) | Weightlifting programs from your coach, logged set by set, even offline. (80 at most) |
| **Category** | Health & Fitness | Health & Fitness |
| **App id** | `com.liftmason.app` | `com.liftmason.app` |
| **Privacy policy URL** | https://app.liftmason.com/privacy | same |
| **Terms URL** | https://app.liftmason.com/terms | same |
| **Account deletion URL** | — (deletion is in the app) | https://app.liftmason.com/delete-account |
| **Support** | [support email or page] | [support email] |
| **Price** | Free (gyms subscribe on the web) | Free |

**Why free in the stores:** gyms pay for their subscription on the web, through Stripe. The app itself sells nothing and shows no prices, so there are no in-app purchases.

> **Paying outside the app (Apple guideline 3.1):** the phone apps must not sell, show prices, or link to paying elsewhere. Settings' "Plan" section (plans, "Choose a plan", "Manage billing") therefore shows only on the web, and a test keeps it that way. Selling to gyms on the web, with coaches and athletes then using the app, is the usual arrangement for business services (Apple's 3.1.3). If a reviewer asks, that's the answer.

## Description (both stores)

> Liftmason connects weightlifting coaches and their athletes.
>
> **For athletes**
> - Your week's training from your coach, with every set, load and target laid out.
> - Log each set as you go: it works with no signal, in the basement gym, and syncs when you're back online.
> - A quick check-in before each session, so your coach knows how you're feeling.
> - Your progress: estimated maxes, personal records and training history.
> - Messages with your coach, and form videos for technique feedback.
> - Habits your coach prescribes, ticked off day by day.
>
> **For coaches**
> - Your athletes' training, check-ins, personal records and form videos in one place.
> - An attention feed that shows who needs you: missed sessions, pain reports, new videos, messages.
> - Build programs on the web with a drag-and-drop weekly board, templates and your own exercise library, then publish them to athletes' phones.
>
> Coaches start on the web at app.liftmason.com. Athletes join through their coach's invite.

**App Store keywords** (100 characters at most, comma-separated): `weightlifting,olympic lifting,coach,strength,training log,snatch,clean and jerk,program,powerlifting`

## What's new (the first version)

> The first release of Liftmason.

## Age rating

Answer the questionnaires with:
- no violence, sexual content, gambling, drugs or alcohol;
- no unrestricted web access;
- **user-generated content: yes** (messages between a coach and their athletes, and form videos, private to the two of them).

Expect a 4+ / Everyone rating, possibly 12+ on the App Store because of messaging. [Decide the minimum age of users (see the privacy policy's "Children").]

## Apple: App Privacy ("nutrition label")

**Tracking:** No. Liftmason doesn't track people across other companies' apps or sites.

Collected, **linked to the user**, used **only for app functionality**:

| Apple's data type | What it is in Liftmason |
|---|---|
| Contact Info → Name, Email Address | the account |
| Health & Fitness → Fitness | training records, maxes, bodyweight, habits |
| Health & Fitness → Health | check-in answers and issue reports can mention pain or injury |
| User Content → Photos or Videos, Audio Data | form videos, with their sound |
| User Content → Other User Content | messages, notes |
| Identifiers → User ID | the account id |
| Diagnostics → Crash Data | only if Sentry is turned on; **not linked** to the user |

## Google Play: Data safety

- **Is data collected?** Yes.
- **Is data shared with third parties?** No. Service providers acting for the app (hosting, email, storage) don't count as sharing.
- **Is data encrypted in transit?** Yes.
- **Can people request deletion?** Yes, in the app and at https://app.liftmason.com/delete-account.

What's collected, all **required** for the app to work (not optional), for **app functionality** and **account management**:
- **Personal info:** name, email address, user IDs.
- **Health and fitness:** health info (pain and injury mentions), fitness info.
- **Photos and videos:** videos. **Audio:** voice or sound recordings (the videos' sound).
- **Messages:** other in-app messages.
- **App info and performance:** crash logs, only if Sentry is on.

## Screenshots

**Needed:**
- **App Store:** iPhone 6.9" (1320 × 2868 or 1290 × 2796), 3 to 10 of them. iPad isn't needed (the app is phone-only).
- **Google Play:** phone screenshots, 2 to 8, 16:9 or 9:16. Also a 1024 × 500 feature graphic.

**Suggested set** (the review gym is ideal to capture them from; sign in as the review account):
1. The athlete's week (home).
2. Logging a set in the session player.
3. The check-in.
4. Progress: the chart and personal records.
5. The coach's Today screen, with the attention feed.
6. An athlete's page on the coach side (overview).
7. Messages.

## Notes for Apple's reviewers (App Review Information)

> **Sign in:** enter `[REVIEW_ACCOUNT_EMAIL]`, tap "Email me a code", then enter the code `[REVIEW_ACCOUNT_CODE]`. No email needs to be received.
>
> This account is both a coach and an athlete in a demonstration gym ("Liftmason Review Gym"). It opens in Coaching; for the athlete's side, go to More → Switch to training.
>
> Programming (building weekly programs) is designed for a computer and is also available at https://app.liftmason.com with the same sign-in.
>
> To delete an account: Profile (athlete) or Account (coach) → Delete my account.

Before submitting, run `python manage.py seed_review --reset` on the production server, so the dates are fresh. `docs/LAUNCH.md` has the steps.
