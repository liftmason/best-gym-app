import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { checkinFinish } from '@/sync/actions';
import { Loading, SessionScreen } from '@/training/session/screen';
import { useLog } from '@/training/session/use-log';
import { Button, Card, colors, FlowHead, space, Text } from '@/ui';

/** The check-in's answers, then start (or skip the check-in). */
export default function Summary() {
  const { world, log, logId, engine } = useLog();
  if (!world) return <Loading />;
  if (!log || log.finished_at) return <Redirect href={{ pathname: '/session/[log]/player', params: { log: logId, n: '1' } }} />;
  const answers = world.answersOf.get(log.id) ?? [];
  const total = world.questions.length + 1;
  const count = (world.exercisesOfLog.get(log.id) ?? []).filter((se) => !se.warmup).length;
  const weekType = log.week_type_id ? world.weekType.get(log.week_type_id) : undefined;

  async function go(skip: boolean) {
    await engine.enqueue(checkinFinish, { session_log_id: logId, skip });
    router.replace({ pathname: '/session/[log]/player', params: { log: logId, n: '1' } });
  }

  return (
    <SessionScreen
      footer={
        <>
          <Button title="Start session →" size="lg" block onPress={() => go(false)} />
          <Button title="Skip check-in this time" variant="soft" block onPress={() => go(true)} />
        </>
      }
    >
      <FlowHead
        icon="arrow-left"
        label="Back"
        onBack={() =>
          world.questions.length
            ? router.replace({ pathname: '/session/[log]/checkin', params: { log: logId, n: String(world.questions.length) } })
            : router.back()
        }
        progress={100}
        step={`${total} of ${total}`}
      />
      <Text variant="h3">Check-in complete</Text>
      <Card style={styles.card}>
        {answers.map((a) => (
          <View key={a.id} style={styles.row}>
            <Text variant="tiny" tone="muted" style={styles.question}>
              {a.question_text}
            </Text>
            <Text variant="tiny" style={styles.answer}>
              {a.type === 'choice' && a.other_text ? a.other_text : a.type === 'scale' ? `${a.value} / 10` : a.value || '—'}
            </Text>
          </View>
        ))}
        <View style={[styles.row, answers.length ? styles.rule : null]}>
          <Text variant="tiny" tone="muted">
            Session
          </Text>
          <Text variant="tiny" style={styles.answer}>
            {count} exercise{count === 1 ? '' : 's'}
            {weekType ? ` · ${weekType.name} week` : ''}
          </Text>
        </View>
      </Card>
    </SessionScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.m },
  rule: { borderTopWidth: 1, borderTopColor: colors.line2, paddingTop: 8 },
  question: { maxWidth: '55%' },
  answer: { textAlign: 'right', fontWeight: '700', flexShrink: 1 },
});
