/**
 * Signing in with an email code: the email, then the 6-digit code. A known email signs in;
 * a new one comes back with a sign-up ticket for the caller to finish (new coach, or joining
 * through an invite).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { Button, Field, Text } from '@/ui';

import { deviceLabel } from './device';

type Props = {
  initialEmail?: string;
  /** Called once the tokens are kept (the router then leaves sign-in). */
  onSignedIn?: () => void;
  onTicket: (ticket: string, email: string) => void;
};

function problem(error: unknown): { field?: string; message: string } {
  if (error instanceof ApiError) {
    const [field, message] = Object.entries(error.fields)[0] ?? [];
    return field ? { field, message } : { message: error.message };
  }
  return { message: 'Something went wrong. Try again.' };
}

export function EmailCode({ initialEmail = '', onSignedIn, onTicket }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [resent, setResent] = useState(false);

  async function send(again = false) {
    setBusy(true);
    setError(null);
    try {
      await ok(api.client.POST('/api/v1/auth/email/start', { body: { email: email.trim() } }));
      setStage('code');
      setResent(again);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const answer = await ok(
        api.client.POST('/api/v1/auth/email/verify', {
          body: { email: email.trim(), code: code.trim(), device: deviceLabel() },
        }),
      );
      if (answer.signed_in && answer.tokens) {
        await api.signedIn(answer.tokens);
        onSignedIn?.();
      } else if (answer.ticket) {
        onTicket(answer.ticket, email.trim());
      }
    } catch (e) {
      setError(problem(e));
      setBusy(false);
    }
  }

  if (stage === 'email') {
    return (
      <View style={styles.form}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => send()}
          error={error?.message}
        />
        <Button title="Email me a code" size="lg" block busy={busy} disabled={!email.trim()} onPress={() => send()} />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text variant="small" tone="muted">
        We sent a 6-digit code to <Text variant="small">{email.trim()}</Text>. It works for 10 minutes.
      </Text>
      <Field
        label="Code"
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        returnKeyType="go"
        onSubmitEditing={verify}
        error={error?.message}
        hint={resent ? 'A new code is on its way.' : undefined}
      />
      <Button title="Sign in" size="lg" block busy={busy} disabled={code.length !== 6} onPress={verify} />
      <View style={styles.row}>
        <Button title="Send a new code" variant="ghost" size="sm" disabled={busy} onPress={() => send(true)} />
        <Button
          title="Use a different email"
          variant="ghost"
          size="sm"
          disabled={busy}
          onPress={() => {
            setStage('email');
            setCode('');
            setError(null);
          }}
        />
      </View>
      {__DEV__ ? (
        <Text variant="tiny" tone="faint">
          Development: demo accounts use 123456; other codes print in the backend&apos;s console.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
