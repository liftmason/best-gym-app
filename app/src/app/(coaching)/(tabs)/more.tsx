import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { DeleteAccount } from '@/auth/delete-account';
import { ReportBugLink } from '@/support/report-bug';
import { useMe } from '@/auth/me';
import { HOME, rememberMode } from '@/auth/mode';
import { signOut } from '@/auth/sign-out';
import { LegalLinks } from '@/legal/links';
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
        <Text variant="h4">Programming and settings</Text>
        <Text variant="small" tone="muted">
          Templates, the exercise library, check-in questions and your gym&apos;s settings. They&apos;re laid out for a computer — open {APP_NAME} on the web — but work here too.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button title="Programming" size="sm" variant="soft" onPress={() => router.push('/programming')} />
          <Button title="Settings" size="sm" variant="soft" onPress={() => router.push('/settings')} />
        </View>
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
      <ReportBugLink side="coach" block />
      <Button title="Sign out" variant="ghost" block onPress={signOut} />
      <DeleteAccount />
      <LegalLinks />
    </CoachScreen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center', gap: space.m },
});
