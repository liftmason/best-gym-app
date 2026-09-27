import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe } from '@/auth/me';
import { HOME, rememberMode } from '@/auth/mode';
import { signOut } from '@/auth/sign-out';
import { useSync } from '@/sync/provider';
import { TrainingHeader } from '@/training/header';
import { Avatar, Button, Card, space, Text } from '@/ui';

/** Profile: who, switching to coaching, signing out. Training numbers and settings come in S5b. */
export default function Profile() {
  const { profile } = useSync();
  const me = useMe();
  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <TrainingHeader />
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="h3">Profile &amp; metrics</Text>
        <Card style={styles.who}>
          <Avatar name={profile.name} size={52} />
          <View style={{ flex: 1 }}>
            <Text variant="h4">{profile.name}</Text>
            <Text variant="tiny" tone="muted">
              {[profile.coachName && `Coached by ${profile.coachName}`, profile.gymName].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Card>
        {me.data?.coach ? (
          <Button
            title="Switch to Coaching"
            variant="soft"
            block
            onPress={async () => {
              await rememberMode('coaching');
              router.replace(HOME.coaching);
            }}
          />
        ) : null}
        <Button title="Sign out" variant="ghost" block onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: 18, gap: space.m },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.m },
});
