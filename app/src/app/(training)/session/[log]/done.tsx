import { Feather } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { nextSessionDate, prSessionExercises, setText, streak, top } from '@/domain/history';
import { setCounts, topSets } from '@/domain/player';
import { longDay } from '@/training/format';
import { Loading, SessionScreen } from '@/training/session/screen';
import { useLog } from '@/training/session/use-log';
import { Button, Card, colors, fonts, radius, space, Text } from '@/ui';

/** The mockup's #m-done: saved, the numbers, the streak, and any new bests. */
export default function Done() {
  const { world, log, coach } = useLog();
  if (!world) return <Loading />;
  if (!log || !log.finished_at) return <Redirect href="/home" />;
  const [exercises, done, planned] = setCounts(world, log);
  const tops = topSets(world, log);
  const days = streak(world, world.today);
  const next = nextSessionDate(world, world.today);
  const prs = prSessionExercises(world);
  const bests = (world.exercisesOfLog.get(log.id) ?? []).filter((se) => prs.has(se.id));

  return (
    <SessionScreen footer={<Button title="Back to my week" block onPress={() => router.dismissTo('/home')} />}>
      <View style={styles.hero}>
        <View style={styles.check}>
          <Feather name="check" size={34} color={colors.white} />
        </View>
        <Text variant="h2">Session complete</Text>
        <Text variant="tiny" tone="muted">
          Your results and notes have been shared with {coach}.
        </Text>
      </View>
      <View style={styles.stats}>
        {[
          [String(exercises), `exercise${exercises === 1 ? '' : 's'}`],
          [`${done}/${planned}`, 'sets done'],
          [String(log.session_rpe ?? '—'), 'session RPE'],
        ].map(([value, label]) => (
          <View key={label} style={styles.stat}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>
      {bests.length ? (
        <Card style={styles.bests}>
          <Text variant="h4">New best{bests.length > 1 ? 's' : ''} 🏆</Text>
          {bests.map((se) => (
            <Text key={se.id} variant="small">
              {se.exercise_name} · {setText(top((world.setsOf.get(se.id) ?? []).filter((s) => s.done)), world.athlete.units)}
            </Text>
          ))}
        </Card>
      ) : null}
      <Card style={styles.streak}>
        <Text variant="h4">
          {days}-session streak
        </Text>
        <Text variant="tiny" tone="muted" style={styles.centred}>
          Saved with {log.checkin_skipped ? '' : 'your check-in, '}
          {tops} top set{tops === 1 ? '' : 's'} and your notes — {coach} sees all of it in your history.
          {next ? ` Next session ${longDay(next)}.` : ''}
        </Text>
      </Card>
    </SessionScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6, marginTop: space.l },
  check: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: space.s },
  stat: { flex: 1, alignItems: 'center', backgroundColor: colors.surface2, borderRadius: radius.m, paddingVertical: space.m },
  statValue: { fontFamily: fonts.extrabold, fontSize: 20 },
  statLabel: { fontSize: 10.5, textTransform: 'uppercase', color: colors.ink3, fontFamily: fonts.semibold },
  bests: { gap: 4, borderColor: colors.warn, backgroundColor: colors.warnLight },
  streak: { alignItems: 'center', gap: 2 },
  centred: { textAlign: 'center' },
});
