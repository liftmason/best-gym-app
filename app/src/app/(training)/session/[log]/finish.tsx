import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { steps } from '@/domain/sessions';
import { Refused, sessionFinish } from '@/sync/actions';
import { ISSUE_KINDS } from '@/sync/actions/issue-report';
import { IssueSheet } from '@/training/session/issue-sheet';
import { Loading, SessionScreen } from '@/training/session/screen';
import { useLog } from '@/training/session/use-log';
import { Button, colors, Field, FlowHead, fonts, radius, Scale, space, Text } from '@/ui';

/** Session RPE and notes (the mockup's #m-post); also where an issue is reported. */
export default function Finish() {
  const { world, log, logId, engine, coach, open } = useLog();
  const [rpe, setRpe] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!world) return <Loading />;
  if (!log || !open) return <Redirect href="/home" />;
  const chosen = rpe ?? (log.session_rpe ? String(log.session_rpe) : '');
  const note = comment ?? log.comment;
  const issues = world.issuesOf.get(log.id) ?? [];
  const count = steps(world.exercisesOfLog.get(log.id) ?? []).length;

  async function save() {
    setProblem(null);
    try {
      await engine.enqueue(sessionFinish, { session_log_id: logId, rpe: Number(chosen), comment: note });
      router.replace({ pathname: '/session/[log]/done', params: { log: logId } });
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't save. Try again.");
    }
  }

  return (
    <SessionScreen
      footer={
        <>
          <Button title="Report an issue or pain" variant="danger" block onPress={() => setReporting(true)} />
          <Button title={log.finished_at ? 'Save changes' : 'Finish & save'} size="lg" block disabled={!chosen} onPress={save} />
        </>
      }
    >
      <FlowHead
        icon="arrow-left"
        label="Back to the last exercise"
        onBack={() =>
          count ? router.replace({ pathname: '/session/[log]/player', params: { log: logId, n: String(count) } }) : router.back()
        }
        step={log.finished_at ? 'Edit how the session went' : 'Session complete. Two quick questions'}
      />
      <Text variant="h3">How hard was this session?</Text>
      <Text variant="tiny" tone="muted">
        Session RPE: 1 is very easy, 10 is maximal effort.
      </Text>
      <Scale value={chosen} onPick={setRpe} spoken={(i) => `RPE ${i}`} />
      <View style={styles.label}>
        <Text variant="label" tone="muted">
          Notes for {coach}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setComment('')} hitSlop={6}>
          <Text variant="tiny" tone="brand" style={{ fontFamily: fonts.semibold }}>
            skip
          </Text>
        </Pressable>
      </View>
      <Field
        label={`Notes for ${coach}`}
        value={note}
        onChangeText={setComment}
        multiline
        maxLength={2000}
        placeholder="e.g. jerks felt better with the narrower grip"
      />
      {issues.map((issue) => (
        <View key={issue.id} style={styles.issue}>
          <Text variant="tiny" style={{ fontFamily: fonts.bold, color: colors.bad }}>
            {ISSUE_KINDS[issue.kind as keyof typeof ISSUE_KINDS] ?? issue.kind}
          </Text>
          {issue.text ? <Text variant="tiny">{issue.text}</Text> : null}
        </View>
      ))}
      {problem ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
      <IssueSheet open={reporting} onClose={() => setReporting(false)} logId={logId} coach={coach} engine={engine} />
    </SessionScreen>
  );
}

const styles = StyleSheet.create({
  label: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.s },
  issue: { backgroundColor: colors.badLight, borderRadius: radius.m, padding: space.m, gap: 2 },
});
