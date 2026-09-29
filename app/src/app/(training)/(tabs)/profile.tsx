import { useFocusEffect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe } from '@/auth/me';
import { HOME, rememberMode } from '@/auth/mode';
import { signOut } from '@/auth/sign-out';
import { DeleteAccount } from '@/auth/delete-account';
import { LegalLinks } from '@/legal/links';
import { currentMetrics, type Current } from '@/domain/metrics';
import { useSync } from '@/sync/provider';
import { TrainingHeader } from '@/training/header';
import { MetricSheet, shown } from '@/training/profile/metric-sheet';
import { pendingProfile } from '@/training/profile/pending';
import { Settings } from '@/training/profile/settings';
import { useTraining } from '@/training/use-training';
import { Avatar, Button, Card, Chip, colors, fonts, space, Text } from '@/ui';

/** Profile & metrics (the mockup's #m-profile): who, the training numbers, settings, sign out. */
export default function Profile() {
  const { profile, database, engine } = useSync();
  const world = useTraining();
  const me = useMe();
  const [editing, setEditing] = useState<Current | null>(null);
  const [pending, setPending] = useState<{ height_cm?: string; years_training?: string }>({});

  useEffect(() => {
    let alive = true;
    const read = () => pendingProfile(database).then((p) => alive && setPending(p));
    read();
    const stop = engine.subscribe(read);
    return () => {
      alive = false;
      stop();
    };
  }, [database, engine]);
  const { refetch } = me;
  useFocusEffect(
    useCallback(() => {
      refetch(); // height, years and settings changed elsewhere, or just synced
    }, [refetch]),
  );

  const metrics = world
    ? currentMetrics(world, {
        heightCm: pending.height_cm ?? profile.heightCm,
        yearsTraining: pending.years_training ?? profile.yearsTraining,
      })
    : [];
  const coach = profile.coachName?.split(/\s+/)[0];

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
        <Card style={{ gap: space.s }}>
          <Text variant="h4">Training metrics</Text>
          <Text variant="tiny" tone="muted">
            {coach ?? 'Your coach'} uses these to set your percentages. Anything marked missing you can add any time.
          </Text>
          {metrics.map((m) => (
            <Pressable
              key={m.key}
              accessibilityRole="button"
              accessibilityLabel={`${m.label}: ${m.value === null ? 'missing' : shown(m, profile.units)}. Change`}
              onPress={() => setEditing(m)}
              style={styles.metric}
            >
              <Text variant="small" style={styles.grow}>
                {m.label}
              </Text>
              {m.value === null ? <Chip tone="warn" label="missing, tap to add" /> : <Text style={styles.value}>{shown(m, profile.units)}</Text>}
            </Pressable>
          ))}
        </Card>
        <Settings units={profile.units} hideHistory={Boolean(me.data?.athlete?.hide_history_before_link)} coachName={profile.coachName} />
        {me.data?.coach ? (
          <Button
            title="Switch to coaching"
            block
            onPress={async () => {
              await rememberMode('coaching');
              router.replace(HOME.coaching);
            }}
          />
        ) : me.data ? (
          <Button title="Start coaching" block onPress={() => router.push('/start-coaching')} />
        ) : null}
        <Button title="Sign out" variant="ghost" block onPress={signOut} />
        <DeleteAccount />
        <LegalLinks />
      </ScrollView>
      <MetricSheet metric={editing} unit={profile.units} engine={engine} onClose={() => setEditing(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: 18, paddingBottom: space.xxl, gap: space.m },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  metric: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line2 },
  grow: { flex: 1 },
  value: { fontFamily: fonts.bold, fontSize: 14 },
});
