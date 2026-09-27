/** An athlete's Overview tab (the mockup's #tab-overview). */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { dayMonth, shortDay } from '@/training/format';
import { Card, Chip, colors, fonts, radius, space, Text } from '@/ui';

import { E1rmChart, VolumeChart } from '../charts';
import { Loading } from '../layout';
import { useOverview } from '../queries';
import { RpePill } from '../rpe';

export function WeekGlance({ days }: { days: { date: string; label: string; today: boolean }[] }) {
  return (
    <View style={styles.glance}>
      {days.map((d) => (
        <View key={d.date} style={[styles.day, d.today && styles.today]}>
          <Text style={[styles.dayName, d.today && { color: colors.white }]}>{shortDay(d.date)}</Text>
          <Text variant="tiny" style={d.today ? { color: colors.white } : undefined}>
            {d.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Overview({ id, unit }: { id: string; unit: string }) {
  const [lift, setLift] = useState<string | null>(null);
  const overview = useOverview(id, lift);
  if (!overview.data) return <Loading error={overview.error} retry={() => overview.refetch()} />;
  const { chart, weekly, checkins, week, top_prs } = overview.data;
  return (
    <View style={{ gap: space.m }}>
      <Card style={{ gap: space.s }}>
        <View style={styles.spread}>
          <Text variant="h4">Estimated 1RM trend</Text>
          {chart.change?.change ? (
            <Chip
              tone={chart.change.change > 0 ? 'good' : 'plain'}
              label={`${chart.change.change > 0 ? `▲ +${chart.change.change}` : `▼ ${chart.change.drop}`} ${unit} / ${chart.change.weeks} wk`}
            />
          ) : null}
        </View>
        {chart.lifts.length > 1 ? (
          <View style={styles.lifts}>
            {chart.lifts.map((l) => {
              const on = l.id === (chart.lift?.id ?? null);
              return (
                <Pressable key={l.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setLift(l.id)} style={[styles.lift, on && styles.liftOn]}>
                  <Text variant="tiny" style={[styles.bold, on && { color: colors.brand }]}>
                    {l.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <E1rmChart chart={chart} unit={unit} />
        <Text variant="tiny" tone="muted">
          e1RM ({unit}) · bodyweight (dashed) · shaded bands = training phase
        </Text>
      </Card>
      <Card style={{ gap: space.s }}>
        <View style={styles.spread}>
          <Text variant="h4">Weekly volume &amp; compliance</Text>
          <Text variant="tiny" tone="muted">
            last {weekly.length} weeks
          </Text>
        </View>
        <VolumeChart weeks={weekly} unit={unit} />
      </Card>
      <Card style={{ gap: space.s }}>
        <Text variant="h4">Recent check-ins</Text>
        {checkins.length ? (
          checkins.map((c) => (
            <View key={c.session_id} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="tiny" style={styles.bold}>
                  {dayMonth(c.date)} · {c.name}
                </Text>
                <Text variant="tiny" tone="muted">
                  {c.readiness ? `Readiness ${c.readiness}/10` : 'Check-in skipped'}
                  {c.choice ? ` · “${c.choice}”` : ''}
                </Text>
              </View>
              <RpePill rpe={c.rpe} />
            </View>
          ))
        ) : (
          <Text variant="small" tone="muted">
            No check-ins yet.
          </Text>
        )}
      </Card>
      <Card style={{ gap: space.s }}>
        <Text variant="h4">This week at a glance</Text>
        {week.length ? <WeekGlance days={week} /> : <Text variant="small" tone="muted">No program this week.</Text>}
      </Card>
      <Card style={{ gap: space.s }}>
        <Text variant="h4">Lifetime PRs</Text>
        {top_prs.length ? (
          top_prs.map((pr) => (
            <View key={pr.name} style={styles.row}>
              <Feather name="award" size={16} color={colors.warn} />
              <Text variant="small" style={[styles.bold, { flex: 1 }]}>
                {pr.name}
              </Text>
              <Text variant="small">
                {pr.heaviest} <Text variant="tiny" tone="muted">· {pr.ago}</Text>
              </Text>
            </View>
          ))
        ) : (
          <Text variant="small" tone="muted">
            No loaded lifts logged yet.
          </Text>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  lifts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  lift: { borderWidth: 1, borderColor: colors.line, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  liftOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  bold: { fontFamily: fonts.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.line2 },
  glance: { flexDirection: 'row', gap: 5 },
  day: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: radius.s, backgroundColor: colors.surface2 },
  today: { backgroundColor: colors.brand },
  dayName: { fontSize: 10, fontFamily: fonts.bold, textTransform: 'uppercase', color: colors.ink3 },
});
