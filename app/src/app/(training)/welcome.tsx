import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { metricSpecs, YEARS } from '@/domain/metrics';
import { metricsUpdate, Refused } from '@/sync/actions';
import { useSync } from '@/sync/provider';
import { Loading, SessionScreen } from '@/training/session/screen';
import { useTraining } from '@/training/use-training';
import { Button, Card, colors, Field, fonts, radius, space, Text } from '@/ui';

/** After joining through an invite (the mockup's #m-onboard): the training numbers, then what's next. */
export default function Welcome() {
  const world = useTraining();
  const { engine, profile } = useSync();
  const [step, setStep] = useState<'numbers' | 'done'>('numbers');
  const [values, setValues] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [gap, setGap] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!world) return <Loading />;
  const specs = metricSpecs(world);
  const coach = profile.coachName?.split(/\s+/)[0] ?? 'Your coach';

  async function save(all: boolean) {
    setProblem(null);
    const filled = all ? {} : Object.fromEntries(Object.entries(values).filter(([k, v]) => v.trim() && !skipped.has(k)));
    try {
      if (Object.keys(filled).length) await engine.enqueue(metricsUpdate, { values: filled });
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't save that. Try again.");
      return;
    }
    const blank = specs.length - Object.keys(filled).length;
    setGap(
      all || blank === specs.length
        ? ` (all metrics skipped, so ${coach} will fill them at your first session)`
        : blank
          ? ` (${blank} field${blank === 1 ? '' : 's'} left blank, so your coach can fill ${blank === 1 ? 'it' : 'them'} in)`
          : '',
    );
    setStep('done');
  }

  const bars = (
    <View style={styles.bars}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={[styles.bar, i <= (step === 'numbers' ? 2 : 3) && styles.barOn]} />
      ))}
    </View>
  );
  const invite = (
    <View style={styles.invite}>
      <Text variant="tiny" style={styles.inviteSmall}>
        You&apos;ve been invited by
      </Text>
      <Text style={styles.inviteName}>
        {profile.coachName ?? 'your coach'}
        {profile.gymName ? ` at ${profile.gymName}` : ''}
      </Text>
    </View>
  );

  if (step === 'done') {
    return (
      <SessionScreen footer={<Button title="Show me my week →" size="lg" block onPress={() => router.replace('/home')} />}>
        {invite}
        {bars}
        <View style={styles.hero}>
          <View style={styles.check}>
            <Feather name="check" size={30} color={colors.white} />
          </View>
          <Text variant="h2">You&apos;re all set</Text>
          <Text variant="small" tone="muted" style={styles.centred}>
            {coach} has your details{gap}.
          </Text>
        </View>
        <Card style={{ gap: space.m }}>
          <Text variant="h4">What happens next</Text>
          {(
            [
              ['calendar', 'Your first programmed week appears on the home screen'],
              ['check-circle', `Before each session you'll answer a short check-in from ${coach}`],
              ['play-circle', `Every exercise includes ${coach}'s demo video`],
            ] as const
          ).map(([icon, text]) => (
            <View key={icon} style={styles.next}>
              <Feather name={icon} size={18} color={colors.brand} />
              <Text variant="small" style={{ flex: 1 }}>
                {text}
              </Text>
            </View>
          ))}
        </Card>
      </SessionScreen>
    );
  }

  return (
    <SessionScreen
      footer={
        <>
          <Button title="Continue" size="lg" block onPress={() => save(false)} />
          <Button title="Skip all for now" variant="ghost" size="sm" onPress={() => save(true)} />
        </>
      }
    >
      {invite}
      {bars}
      <Text variant="h3">Your training numbers</Text>
      <Text variant="small" tone="muted">
        {coach} programs off these. <Text variant="small" style={{ fontFamily: fonts.bold }}>Skip anything you don&apos;t know</Text>. Your
        coach can fill it in later.
      </Text>
      {specs.map((spec) => {
        const off = skipped.has(spec.key);
        const label =
          spec.kind === 'weight' ? `${spec.label} (${profile.units})` : spec.kind === 'height' ? `${spec.label} (cm)` : spec.label;
        return (
          <View key={spec.key} style={styles.metric}>
            <View style={styles.metricHead}>
              <Text variant="label" tone="muted">
                {label}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={off ? `${spec.label} skipped` : `Skip ${spec.label}`}
                disabled={off}
                onPress={() => setSkipped(new Set([...skipped, spec.key]))}
                hitSlop={6}
              >
                <Text variant="tiny" tone={off ? 'faint' : 'brand'}>
                  {off ? 'skipped' : 'skip'}
                </Text>
              </Pressable>
            </View>
            {spec.kind === 'years' ? (
              <View style={styles.choices}>
                {YEARS.map(([v, text]) => (
                  <Pressable
                    key={v}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: values[spec.key] === v, disabled: off }}
                    disabled={off}
                    onPress={() => setValues({ ...values, [spec.key]: v })}
                    style={[styles.choice, values[spec.key] === v && styles.on, off && { opacity: 0.4 }]}
                  >
                    <Text style={{ fontFamily: fonts.bold }}>{text}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Field
                label={label}
                value={off ? '' : (values[spec.key] ?? '')}
                onChangeText={(text) => setValues({ ...values, [spec.key]: text })}
                keyboardType="decimal-pad"
                editable={!off}
                placeholder={off ? 'skipped, coach can fill in' : spec.exerciseId ? 'best single' : spec.key === 'bodyweight' ? 'e.g. 64' : 'e.g. 168'}
              />
            )}
          </View>
        );
      })}
      {problem ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
    </SessionScreen>
  );
}

const styles = StyleSheet.create({
  invite: { backgroundColor: colors.ink, borderRadius: radius.l, padding: space.l, gap: 2 },
  inviteSmall: { color: colors.white, opacity: 0.7 },
  inviteName: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surface3 },
  barOn: { backgroundColor: colors.brand },
  metric: { gap: 4 },
  metricHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  choice: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingVertical: 10, paddingHorizontal: 14 },
  on: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  hero: { alignItems: 'center', gap: 6, marginTop: space.l },
  check: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  centred: { textAlign: 'center' },
  next: { flexDirection: 'row', alignItems: 'center', gap: space.m },
});
