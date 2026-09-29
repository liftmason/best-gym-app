import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { api, ApiError, ok } from '@/api';
import { deviceLabel, deviceTimezone } from '@/auth/device';
import { SignInFrame } from '@/auth/frame';
import { GymForm, type GymChoices } from '@/auth/gym-form';
import { signUp } from '@/auth/pending';
import { Button, Text } from '@/ui';
import { APP_NAME } from '@/name';

/** A new coach sets up their gym, for an email just verified on sign-in. */
export default function NewCoach() {
  const pending = signUp.get();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!pending) return <Redirect href="/sign-in" />;

  async function create(choices: GymChoices) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await ok(
        api.client.POST('/api/v1/auth/signup/coach', {
          body: { ticket: pending.ticket, ...choices, timezone: deviceTimezone(), device: deviceLabel() },
        }),
      );
      signUp.clear();
      await api.signedIn(tokens);
    } catch (e) {
      setError(e instanceof ApiError ? e : ApiError.unexpected());
      setBusy(false);
    }
  }

  return (
    <SignInFrame>
      <Text variant="h2">Set up your gym</Text>
      <Text variant="small" tone="muted">
        New to {APP_NAME} as {pending.email}. Athletes join later through invite links.
      </Text>
      <GymForm busy={busy} error={error} onSubmit={create} />
      <Button
        title="Back"
        variant="ghost"
        onPress={() => {
          signUp.clear();
          router.replace('/sign-in');
        }}
      />
    </SignInFrame>
  );
}
