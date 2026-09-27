import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { e1rmPoints, progressChange, progressLifts } from '@/domain/charts';
import { ago, e1rmText, lifetimePrs, recentFinished, setText } from '@/domain/history';
import { editable } from '@/domain/sessions';
import { fromKg } from '@/domain/units';
import { useSync } from '@/sync/provider';
import { dayMonth } from '@/training/format';
import { TrainingHeader } from '@/training/header';
import { Notes } from '@/training/home/notes';
import { OlderSessions } from '@/training/progress/older';
import { useTraining } from '@/training/use-training';
import { Card, Chip, colors, fonts, radius, Sheet, space, Sparkline, Text } from '@/ui';

/** The athlete's progress (the mockup's #m-progress): a lift's e1RM, records, recent sessions. */
export default function Progress() {
  const world = useTraining();
  const { profile } = useSync();
  const [liftId, setLiftId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  if (!world) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  const unit = world.athlete.units;
  const lifts = progressLifts(world);
  const lift = lifts.find((e) => e.id === liftId) ?? lifts[0];
  const values = lift ? e1rmPoints(world, lift.id).map((p) => Number(fromKg(p[1], unit))) : [];
  const change = lift ? progressChange(world, lift.id) : null;
  const prs = lifetimePrs(world);
  const recent = recentFinished(world);
  const now = new Date().toISOString();

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <TrainingHeader />
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="h3">Your progress</Text>
        {lift ? (
          <Card style={{ gap: space.s }}>
            <View style={styles.spread}>
              {lifts.length > 1 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Lift: ${lift.name}. Change`} onPress={() => setChoosing(true)} style={styles.chooser}>
                  <Text variant="h4">{lift.name} e1RM</Text>
                  <Feather name="chevron-down" size={16} color={colors.ink3} />
                </Pressable>
              ) : (
                <Text variant="h4">{lift.name} e1RM</Text>
              )}
              {change?.change ? (
                <Chip
                  tone={change.change > 0 ? 'good' : 'plain'}
                  label={`${change.change > 0 ? `▲ +${change.change}` : `▼ ${change.drop}`} ${unit} / ${change.weeks} wk`}
                />
              ) : null}
            </View>
            <Sparkline values={values} label={`${Math.round(Math.max(...values))} ${unit}`} accessibilityLabel={`${lift.name} progress chart`} />
          </Card>
        ) : null}
        <Notes program={world.program} week={null} coachName={profile.coachName} />

        <Text variant="h4" style={styles.heading}>
          Personal records
        </Text>
        {prs.length ? (
          prs.map((pr) => (
            <View key={pr.exercise_id} style={styles.row}>
              <View style={styles.medal}>
                <Feather name="award" size={16} color={colors.warn} />
              </View>
              <View style={styles.text}>
                <Text variant="small" style={styles.bold}>
                  {pr.name}
                </Text>
                <Text variant="tiny" tone="muted">
                  Heaviest {ago(pr.heaviest_date, world.today)}
                  {pr.e1rm ? ` · best e1RM ${e1rmText(pr.e1rm, unit)}` : ''}
                </Text>
              </View>
              <Text style={styles.value}>{setText(pr.heaviest, unit)}</Text>
            </View>
          ))
        ) : (
          <Text variant="small" tone="muted">
            Your records show up here once you&apos;ve logged a loaded lift.
          </Text>
        )}

        <Text variant="h4" style={styles.heading}>
          Recent sessions
        </Text>
        {recent.length ? (
          recent.map((log) => (
            <Pressable
              key={log.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/session/[log]', params: { log: log.id, review: '1' } })}
              style={styles.row}
            >
              <View style={[styles.medal, { backgroundColor: colors.goodLight }]}>
                <Feather name="check" size={16} color={colors.good} />
              </View>
              <View style={styles.text}>
                <Text variant="small" style={styles.bold}>
                  {dayMonth(log.date)}
                </Text>
                <Text variant="tiny" tone="muted" numberOfLines={1}>
                  {log.name}
                  {log.session_rpe ? ` · RPE ${log.session_rpe}` : ''}
                  {log.comment ? ` · “${log.comment.length > 60 ? `${log.comment.slice(0, 59)}…` : log.comment}”` : ''}
                </Text>
              </View>
              {editable(log, now) ? <Chip label="edit" /> : null}
            </Pressable>
          ))
        ) : (
          <Text variant="small" tone="muted">
            No sessions logged yet.
          </Text>
        )}
        <OlderSessions unit={unit} historyFrom={world.historyFrom} />
      </ScrollView>
      <Sheet open={choosing} onClose={() => setChoosing(false)} title="Chart">
        {lifts.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: e.id === lift?.id }}
            onPress={() => {
              setLiftId(e.id);
              setChoosing(false);
            }}
            style={[styles.choice, e.id === lift?.id && styles.choiceOn]}
          >
            <Text style={styles.bold}>{e.name} e1RM</Text>
          </Pressable>
        ))}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 18, paddingBottom: space.xxl, gap: space.m },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  chooser: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heading: { marginTop: space.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.m,
    padding: space.m,
  },
  medal: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.warnLight, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  bold: { fontFamily: fonts.bold },
  value: { fontFamily: fonts.extrabold, fontSize: 15 },
  choice: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, padding: 13, marginBottom: 8 },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
});
