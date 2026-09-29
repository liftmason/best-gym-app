/** An account that exists already starts coaching (POST /me/coach): an athlete who takes on
 * athletes, or the site admin's account. Coach sign-up only takes new emails. */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { api, ApiError, ok } from '@/api';
import { deviceTimezone } from '@/auth/device';
import { SignInFrame } from '@/auth/frame';
import { GymForm, type GymChoices } from '@/auth/gym-form';
import { ME, useMe } from '@/auth/me';
import { HOME, rememberMode } from '@/auth/mode';
import { Button, Text } from '@/ui';

export function StartCoaching() {
  const me = useMe();
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function start(choices: GymChoices) {
    setBusy(true);
    setError(null);
    try {
      await ok(api.client.POST('/api/v1/me/coach', { body: { ...choices, timezone: deviceTimezone() } }));
      await queries.invalidateQueries({ queryKey: ME });
      await rememberMode('coaching');
      router.replace(HOME.coaching);
    } catch (e) {
      setError(e instanceof ApiError ? e : ApiError.unexpected());
      setBusy(false);
    }
  }

  return (
    <SignInFrame>
      <Text variant="h2">Set up your gym</Text>
      <Text variant="small" tone="muted">
        Coach from this account{me.data ? ` (${me.data.email})` : ''}. Athletes join through invite links, and you can
        still train here.
      </Text>
      {me.data ? <GymForm initialName={me.data.name} busy={busy} error={error} onSubmit={start} /> : null}
      <Button title="Back" variant="ghost" onPress={() => (router.canGoBack?.() ? router.back() : router.replace('/'))} />
    </SignInFrame>
  );
}
