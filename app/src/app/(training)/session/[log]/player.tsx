import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { stepDone, steps } from '@/domain/sessions';
import { warmupTick } from '@/sync/actions';
import { flash } from '@/training/flash';
import { dayMonth } from '@/training/format';
import { ExerciseBlock } from '@/training/session/player/exercise';
import { Warmups } from '@/training/session/player/warmups';
import { Loading, SessionScreen } from '@/training/session/screen';
import { useLog } from '@/training/session/use-log';
import { Button, colors, FlowHead, fonts, radius, space, Text } from '@/ui';

/** Until 5:00 PM on Tue: when a finished session stops being editable. */
function until(finishedAt: string, timezone: string): string {
  const end = new Date(Date.parse(finishedAt) + 24 * 3600 * 1000);
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(end);
  } catch {
    return end.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Screen n of a session (the mockup's #m-player): the warm-up checklist, or an exercise (a superset's together). */
export default function Player() {
  useKeepAwake();
  const { world, log, logId, n, engine, coach, open, profile } = useLog();
  if (!world) return <Loading />;
  if (!log) return <Redirect href="/home" />;
  const list = steps(world.exercisesOfLog.get(log.id) ?? []);
  if (!list.length) return <Redirect href={{ pathname: '/session/[log]/finish', params: { log: logId } }} />;
  if (n > list.length) return <Redirect href={{ pathname: '/session/[log]/player', params: { log: logId, n: '1' } }} />;
  const step = list[n - 1];
  const setsOf = (se: { id: string }) => world.setsOf.get(se.id) ?? [];
  const lastStep = n === list.length;
  const finished = log.finished_at !== null;

  const go = (to: number) => router.replace({ pathname: '/session/[log]/player', params: { log: logId, n: String(to) } });
  function next() {
    if (!lastStep) go(n + 1);
    else if (open) router.replace({ pathname: '/session/[log]/finish', params: { log: logId } });
    else router.back();
  }
  function exit() {
    if (!finished) flash.set('Session paused. Pick it up any time');
    router.back();
  }

  const labels = step.labels.length ? step.labels : [''];
  const superset = !step.warmup && step.items.length > 1;
  return (
    <SessionScreen
      footer={
        <>
          <View style={styles.dots} accessibilityElementsHidden>
            {list.map((s, i) => (
              <View key={i} style={[styles.dot, i + 1 === n ? styles.dotOn : stepDone(s, setsOf) ? styles.dotDone : null]} />
            ))}
          </View>
          <View style={styles.nav}>
            <Button title="← Prev" variant="soft" style={{ flex: 1 }} disabled={n === 1} onPress={() => go(n - 1)} />
            <Button
              title={
                !lastStep ? (step.warmup ? 'Start lifting →' : 'Next exercise →') : !open ? 'Done' : finished ? 'Next →' : 'Finish session →'
              }
              style={{ flex: 2 }}
              onPress={next}
            />
          </View>
        </>
      }
    >
      <FlowHead
        icon="x"
        label={finished ? 'Close' : 'Pause session'}
        onBack={exit}
        progress={((n - 1) / list.length) * 100 + 5}
        step={`${n} / ${list.length}`}
      />
      {finished ? (
        <View style={styles.logged}>
          <Text variant="tiny">
            {open
              ? `Logged on ${dayMonth(log.date)}. You can change it until ${until(log.finished_at!, profile.timezone)}.`
              : `Logged on ${dayMonth(log.date)}. Read only now.`}
          </Text>
        </View>
      ) : null}
      {step.warmup ? (
        <Warmups
          world={world}
          items={step.items}
          coach={coach}
          editable={open}
          onTick={(se, checked) => engine.enqueue(warmupTick, { session_exercise_id: se.id, checked }).catch(() => {})}
        />
      ) : (
        <>
          {step.section ? (
            <View style={styles.section}>
              <Text style={styles.sectionText}>{step.section}</Text>
              {step.section_note ? (
                <Text variant="tiny" tone="muted">
                  {step.section_note}
                </Text>
              ) : null}
            </View>
          ) : null}
          {superset ? (
            <Text variant="tiny" tone="muted">
              Superset. Alternate between these: a set of {labels[0]}, then a set of {labels[1]}
              {labels.length > 2 ? ', and so on' : ''}.
            </Text>
          ) : null}
          {step.items.map((se, i) => (
            <ExerciseBlock
              key={se.id}
              world={world}
              log={log}
              se={se}
              label={labels[i] ?? ''}
              superset={superset}
              coach={coach}
              editable={open}
              engine={engine}
            />
          ))}
        </>
      )}
    </SessionScreen>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.surface3 },
  dotOn: { width: 20, backgroundColor: colors.brand },
  dotDone: { backgroundColor: colors.good },
  nav: { flexDirection: 'row', gap: space.s },
  logged: { backgroundColor: colors.brandLight, borderRadius: radius.m, padding: space.m },
  section: { gap: 2 },
  sectionText: { fontFamily: fonts.extrabold, fontSize: 12, textTransform: 'uppercase', color: colors.ink3, letterSpacing: 0.6 },
});
