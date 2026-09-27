import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { deviceLabel, deviceTimezone } from '@/auth/device';
import { SignInFrame } from '@/auth/frame';
import { Option } from '@/auth/option';
import { signUp } from '@/auth/pending';
import { Button, Field, Text } from '@/ui';
import { APP_NAME } from '@/name';

/** A new coach sets up their gym, for an email just verified on sign-in. */
export default function NewCoach() {
  const pending = signUp.get();
  const starters = useQuery({
    queryKey: ['starters'],
    queryFn: () => ok(api.client.GET('/api/v1/auth/signup/starters')),
  });
  const [name, setName] = useState('');
  const [gym, setGym] = useState('');
  const [units, setUnits] = useState<'kg' | 'lb'>('kg');
  const [starter, setStarter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!pending) return <Redirect href="/sign-in" />;
  const picked = starter ?? starters.data?.[0]?.key ?? null;

  async function create() {
    if (!pending || !picked) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await ok(
        api.client.POST('/api/v1/auth/signup/coach', {
          body: {
            ticket: pending.ticket,
            name: name.trim(),
            gym_name: gym.trim(),
            units,
            starter: picked,
            timezone: deviceTimezone(),
            device: deviceLabel(),
          },
        }),
      );
      signUp.clear();
      await api.signedIn(tokens);
    } catch (e) {
      setError(e instanceof ApiError ? e : ApiError.offline());
      setBusy(false);
    }
  }

  return (
    <SignInFrame>
      <Text variant="h2">Set up your gym</Text>
      <Text variant="small" tone="muted">
        New to {APP_NAME} as {pending.email}. Athletes join later through invite links.
      </Text>
      <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
      <Field label="Gym name" value={gym} onChangeText={setGym} textContentType="organizationName" />
      <Text variant="label" tone="muted">
        Weights in
      </Text>
      <View style={styles.row}>
        <View style={styles.half}>
          <Option title="Kilograms" selected={units === 'kg'} onPress={() => setUnits('kg')} />
        </View>
        <View style={styles.half}>
          <Option title="Pounds" selected={units === 'lb'} onPress={() => setUnits('lb')} />
        </View>
      </View>
      <Text variant="label" tone="muted">
        Start your exercise library with
      </Text>
      {starters.isError ? (
        <Button title="Couldn't load the choices. Try again" variant="ghost" onPress={() => starters.refetch()} />
      ) : null}
      {starters.data?.map((pack) => (
        <Option
          key={pack.key}
          title={pack.label}
          detail={pack.description}
          selected={picked === pack.key}
          onPress={() => setStarter(pack.key)}
        />
      ))}
      {error ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {error.message}
        </Text>
      ) : null}
      <Button
        title="Create my gym"
        size="lg"
        block
        busy={busy}
        disabled={!name.trim() || !gym.trim() || !picked}
        onPress={create}
      />
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
