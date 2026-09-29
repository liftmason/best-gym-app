/** Setting up a gym: the coach's name, the gym's name and units, and the starter library.
 * Shared by coach sign-up (a new email) and starting to coach from an existing account. */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { Option } from '@/auth/option';
import { Button, Field, Text } from '@/ui';

export type GymChoices = { name: string; gym_name: string; units: 'kg' | 'lb'; starter: string };

export function GymForm({
  initialName = '',
  busy,
  error,
  onSubmit,
}: {
  initialName?: string;
  busy: boolean;
  error: ApiError | null;
  onSubmit: (choices: GymChoices) => void;
}) {
  const starters = useQuery({
    queryKey: ['starters'],
    queryFn: () => ok(api.client.GET('/api/v1/auth/signup/starters')),
  });
  const [name, setName] = useState(initialName);
  const [gym, setGym] = useState('');
  const [units, setUnits] = useState<'kg' | 'lb'>('kg');
  const [starter, setStarter] = useState<string | null>(null);
  const picked = starter ?? starters.data?.[0]?.key ?? null;

  return (
    <>
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
        onPress={() => picked && onSubmit({ name: name.trim(), gym_name: gym.trim(), units, starter: picked })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
