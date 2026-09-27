import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api';
import { SignInFrame } from '@/auth/frame';
import { useMe } from '@/auth/me';
import { signOut } from '@/auth/sign-out';
import { HOME, lastMode, modeFor, type Mode } from '@/auth/mode';
import { Button, colors, Text } from '@/ui';

/** Signed in: /me decides coaching, training, or (with both) the mode last used. */
export default function Index() {
  const me = useMe();
  const [last, setLast] = useState<Mode | null | undefined>(undefined);

  useEffect(() => {
    lastMode().then(setLast);
  }, []);

  if (me.isPending || last === undefined) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (me.isError) {
    const offline = me.error instanceof ApiError && me.error.offline;
    // An athlete trains offline, on this device's copy.
    if (offline && last === 'training') return <Redirect href={HOME.training} />;
    return (
      <SignInFrame>
        <Text variant="h2">{offline ? "Can't reach GymTrainer" : 'Something went wrong'}</Text>
        <Text variant="small" tone="muted">
          {offline ? 'Check your connection and try again.' : 'Try again in a moment.'}
        </Text>
        <Button title="Try again" onPress={() => me.refetch()} />
        <Button title="Sign out" variant="ghost" onPress={signOut} />
      </SignInFrame>
    );
  }

  const mode = modeFor(me.data, last);
  if (!mode) {
    return (
      <SignInFrame>
        <Text variant="h2">No coach yet</Text>
        <Text variant="small" tone="muted">
          Signed in as {me.data.email}. To train with a coach, open the invite link they sent you.
        </Text>
        <Button title="Sign out" variant="ghost" onPress={signOut} />
      </SignInFrame>
    );
  }
  return <Redirect href={HOME[mode]} />;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
