/**
 * Crash reports (docs/plans/S8_LAUNCH.md, decision E): Sentry, as the backend uses, and off
 * until a build sets EXPO_PUBLIC_SENTRY_DSN (the owner's Sentry project; docs/LAUNCH.md).
 * Nothing personal is sent: no names or emails, only the error and where it happened.
 */
import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) Sentry.init({ dsn, sendDefaultPii: false, tracesSampleRate: 0, enabled: !__DEV__ });

/** The app's root, reporting crashes when Sentry is set up (unchanged otherwise). */
export function withReporting<P extends object>(root: ComponentType<P>): ComponentType<P> {
  return dsn ? (Sentry.wrap(root as ComponentType<Record<string, unknown>>) as unknown as ComponentType<P>) : root;
}
