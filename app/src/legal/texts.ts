/**
 * The privacy policy and terms (docs/plans/S8_LAUNCH.md, decision H), shown at /privacy and
 * /terms and linked from the app and the store listings.
 *
 * They are DRAFTS written from what the app actually does. Before launch the owner (with a
 * lawyer) fills in everything in [brackets], checks the rest, and sets DRAFT to false
 * (docs/LAUNCH.md, "Legal"). While DRAFT is true the pages say so.
 */
import { APP_NAME } from '@/name';

export const DRAFT = true;
export const UPDATED = '[date of publication]';

export type Section = { heading: string; paragraphs: string[] };

const BUSINESS = '[legal name of the business]';
const CONTACT = '[privacy contact email, e.g. privacy@liftmason.com]';

export const PRIVACY: Section[] = [
  {
    heading: 'Who we are',
    paragraphs: [
      `${APP_NAME} is run by ${BUSINESS}, [address]. It helps weightlifting coaches program training for their athletes, and athletes log their training. Questions about this policy or your data: ${CONTACT}.`,
    ],
  },
  {
    heading: 'What we collect',
    paragraphs: [
      'Your account: your name, email address and time zone. We sign you in with codes sent to your email; we keep no password unless an administrator sets one.',
      "If you coach: your gym's name and settings, your title, and the programs, templates, exercises and messages you create.",
      'If you train: what you record and what your coach records for you: programs, sessions, sets, loads, repetitions and effort ratings; check-in answers, which can include how you feel, soreness, pain or injuries; notes and issues you report; bodyweight, height, years of training and your maximum lifts; habits you tick off; messages; and form videos you record, with their sound.',
      'Your devices: a name for each signed-in device and, if you allow notifications, a push token so we can reach that device.',
      'Running the service: our servers keep short-lived logs of requests (including your IP address) for security and to limit abuse. If crash reporting is on, reports of app errors are sent without your name or email.',
      "We don't use advertising, analytics or tracking tools, and we don't sell your data.",
    ],
  },
  {
    heading: 'Who sees it',
    paragraphs: [
      'Your coach sees the training you record, your check-ins, messages and form videos, and can change your program. If you join a new coach, they see your earlier training too, unless you choose in your profile to hide what came before them.',
      'Other coaches at your gym may see what your coach sees, once gyms can have several coaches.',
      "Our service providers process data for us and only for this: Render (hosting and the database, in the United States), Cloudflare (form-video storage and the website), Expo (push notifications), [Resend] (email), Sentry (crash reports, if turned on) and Stripe (a gym's subscription payments; card details go to Stripe, never to us).",
      'We share data with anyone else only if the law requires it.',
    ],
  },
  {
    heading: 'How long we keep it',
    paragraphs: [
      "Your account and training history stay until you delete them. Form videos are deleted 90 days after they're uploaded. Sign-in codes expire after 10 minutes, and a signed-in device stays signed in for up to 90 days without use.",
    ],
  },
  {
    heading: 'Deleting your account',
    paragraphs: [
      'You can delete your account at any time: in the app (Profile, or Account for coaches), or on the web at /delete-account.',
      'For an athlete, everything you recorded is deleted straight away, and your coach is told you left.',
      "For a coach, your name and email are removed and you can't sign in again. Your athletes keep their own training history. Messages you sent stay in their conversations, shown as from a former coach. If you were your gym's last coach, its templates and settings are deleted and its subscription is cancelled.",
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      `You can ask to see, correct or export your data, or to have it deleted, by writing to ${CONTACT}. [Add the rights and the contact for the places you operate in, e.g. the EU and UK (GDPR) or California (CCPA).]`,
    ],
  },
  {
    heading: 'Children',
    paragraphs: [
      `[Decide and state the minimum age, e.g. “${APP_NAME} is not for children under 13. Athletes under 18 need a parent's or guardian's permission.” Weightlifting coaches often train teenagers, so this needs a lawyer's advice.]`,
    ],
  },
  {
    heading: 'Changes',
    paragraphs: ["If we change this policy, we'll update the date below and, for significant changes, tell you in the app or by email."],
  },
];

export const TERMS: Section[] = [
  {
    heading: 'Agreement',
    paragraphs: [
      `These terms are an agreement between you and ${BUSINESS} about using ${APP_NAME}. By creating an account you accept them. If you use it for a gym or business, you accept them for it too.`,
    ],
  },
  {
    heading: 'Your account',
    paragraphs: [
      "Keep access to your email secure: it's how you sign in. You're responsible for what happens in your account. Give accurate information, and tell us if you think someone else is using your account.",
    ],
  },
  {
    heading: 'Training at your own risk',
    paragraphs: [
      `${APP_NAME} is a tool for coaches and athletes. It doesn't give medical advice, and it doesn't decide what's safe for you. Programs are written by coaches, who are responsible for them. Weightlifting carries a risk of injury: train within your abilities, stop if something hurts, and see a medical professional about pain or injuries.`,
    ],
  },
  {
    heading: 'Your content',
    paragraphs: [
      'You keep ownership of what you put in: athletes their training records, coaches their programs and templates. You give us permission to store and process it only to run the service for you and the people you share it with.',
      "Don't upload anything unlawful, or anything you don't have the right to share, such as videos of other people without their permission.",
    ],
  },
  {
    heading: 'Subscriptions',
    paragraphs: [
      '[Gyms pay by subscription through Stripe. State the plans and prices, the billing period, what happens if a payment fails (programming becomes read-only, and athletes can always log and see their own training), how to cancel, and the refund policy.]',
    ],
  },
  {
    heading: 'Acceptable use',
    paragraphs: [
      "Don't misuse the service: no attempts to break in, overload it, copy it, or use it to harass anyone. We may suspend accounts that do.",
    ],
  },
  {
    heading: 'Ending',
    paragraphs: [
      "You can stop using the service and delete your account at any time (see the privacy policy). We may end the service or your access with notice, except where the law or abuse requires otherwise, and we'll let you get a copy of your data first where we can.",
    ],
  },
  {
    heading: 'Liability',
    paragraphs: [
      "[Disclaimers and a limit on liability, to be written for the business's jurisdiction by a lawyer.]",
    ],
  },
  {
    heading: 'Changes and contact',
    paragraphs: [
      `We may update these terms; we'll tell you about significant changes before they apply. These terms are governed by the laws of [state/country]. Contact: ${CONTACT}.`,
    ],
  },
];
