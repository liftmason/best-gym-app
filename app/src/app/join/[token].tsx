import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api, ApiError, ok, useAuth } from '@/api';
import { deviceLabel, deviceTimezone } from '@/auth/device';
import { EmailCode } from '@/auth/email-code';
import { SignInFrame } from '@/auth/frame';
import { ME, useMe } from '@/auth/me';
import { signOut } from '@/auth/sign-out';
import { Button, Field, Text } from '@/ui';
import { APP_NAME } from '@/name';

/**
 * An invite link from a coach. Signed in, the account joins as it is. Otherwise the email is
 * verified first: a known email signs in and joins, a new one gives a name and joins as a new
 * athlete.
 */
export default function Join() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const auth = useAuth();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => ok(api.client.GET('/api/v1/join/{token}', { params: { path: { token } } })),
  });

  if (invite.isPending) return <SignInFrame>{null}</SignInFrame>;
  if (invite.isError) {
    const status = invite.error instanceof ApiError ? invite.error.status : 0;
    return (
      <SignInFrame>
        <Text variant="h2">{status === 410 ? 'This invite has been used' : "This invite link doesn't work"}</Text>
        <Text variant="small" tone="muted">
          {status === 0
            ? `Can't reach ${APP_NAME}. Check your connection.`
            : status === 410
              ? 'It may have expired. Ask your coach to send a new one.'
              : 'Check the link, or ask your coach to send a new one.'}
        </Text>
        {status === 0 ? <Button title="Try again" onPress={() => invite.refetch()} /> : null}
        <Button title="Go to sign in" variant="ghost" onPress={() => router.replace('/')} />
      </SignInFrame>
    );
  }

  const { coach_name, gym_name, email } = invite.data;
  return (
    <SignInFrame>
      <Text variant="h2">Join {coach_name}</Text>
      <Text variant="small" tone="muted">
        {coach_name} invited you to train with {gym_name} on {APP_NAME}.
      </Text>
      {auth === 'signedIn' ? <Accept token={token} /> : <NewOrReturning token={token} email={email} />}
    </SignInFrame>
  );
}

function Accept({ token }: { token: string }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await ok(api.client.POST('/api/v1/join/{token}/accept', { params: { path: { token } } }));
      await queryClient.invalidateQueries({ queryKey: ME });
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      {me.data ? (
        <Text variant="small">
          Signed in as {me.data.name} ({me.data.email}).
        </Text>
      ) : null}
      {error ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Join" size="lg" block busy={busy} onPress={accept} />
      <Button title="Not you? Sign out" variant="ghost" disabled={busy} onPress={signOut} />
    </>
  );
}

function NewOrReturning({ token, email }: { token: string; email: string }) {
  const [ticket, setTicket] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ticket) {
    return <EmailCode initialEmail={email} onTicket={(t) => setTicket(t)} />;
  }

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const tokens = await ok(
        api.client.POST('/api/v1/join/{token}/signup', {
          params: { path: { token } },
          body: { ticket: ticket!, name: name.trim(), timezone: deviceTimezone(), device: deviceLabel() },
        }),
      );
      await api.signedIn(tokens);
      router.replace('/welcome'); // a new athlete: their training numbers first
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
        returnKeyType="go"
        onSubmitEditing={join}
        error={error}
      />
      <Button title="Join" size="lg" block busy={busy} disabled={!name.trim()} onPress={join} />
    </>
  );
}
