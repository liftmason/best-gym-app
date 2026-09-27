/**
 * Who's signed in, the switch between Coaching and Training (for an account with both), and
 * sign-out. A stand-in for the profile menus of S5 and S6.
 */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { Button, colors, space, Text } from '@/ui';

import { useMe } from './me';
import { HOME, rememberMode, type Mode } from './mode';

export function AccountBar({ mode }: { mode: Mode }) {
  const me = useMe();
  const other: Mode = mode === 'coaching' ? 'training' : 'coaching';
  const both = Boolean(me.data?.coach && me.data?.athlete);

  return (
    <View style={styles.bar}>
      <Text variant="small" tone="muted" style={styles.who}>
        {me.data ? `${me.data.name} · ${me.data.email}` : ''}
      </Text>
      {both ? (
        <Button
          title={other === 'coaching' ? 'Switch to Coaching' : 'Switch to Training'}
          variant="soft"
          size="sm"
          onPress={async () => {
            await rememberMode(other);
            router.replace(HOME[other]);
          }}
        />
      ) : null}
      <Button title="Sign out" variant="ghost" size="sm" onPress={() => api.signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.s,
    padding: space.l,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  who: { flex: 1, minWidth: 160 },
});
