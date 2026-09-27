import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useMe } from '@/auth/me';
import { HOME, rememberMode } from '@/auth/mode';
import { signOut } from '@/auth/sign-out';
import { CoachScreen } from '@/coaching/layout';
import { Avatar, Button, Card, space, Text } from '@/ui';
import { APP_NAME } from '@/name';

/** The coach's account, and where the rest of coaching is for now. */
export default function More() {
  const me = useMe();
  const gym = me.data?.coach?.gym;
  return (
    <CoachScreen title="Account">
      <Card style={styles.who}>
        <Avatar name={me.data?.name ?? ''} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="h4">{me.data?.name}</Text>
          <Text variant="tiny" tone="muted">
            {[me.data?.email, gym?.name].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Card>
      <Card style={{ gap: space.s }}>
        <Text variant="h4">Programming, the library and settings</Text>
        <Text variant="small" tone="muted">
          These are on the web for now: open {APP_NAME} on a computer. Programming on a phone is planned.
        </Text>
      </Card>
      {me.data?.athlete ? (
        <Button
          title="Switch to Training"
          variant="soft"
          block
          onPress={async () => {
            await rememberMode('training');
            router.replace(HOME.training);
          }}
        />
      ) : null}
      <Button title="Sign out" variant="ghost" block onPress={signOut} />
    </CoachScreen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center', gap: space.m },
});
