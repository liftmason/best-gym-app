/** Today's (or yesterday's) habits, ticked offline (the mockup's #mHabits). */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { forDay, weeklyTarget, type HabitItem } from '@/domain/habits';
import { addDays, type World } from '@/domain/world';
import { habitSet, Refused } from '@/sync/actions';
import { useSync } from '@/sync/provider';
import { Card, colors, fonts, radius, space, Text } from '@/ui';

const CADENCE: Record<string, string> = { daily: 'Every day', training: 'Training days', '3x': '3× a week', '5x': '5× a week' };

function line(item: HabitItem): string {
  const h = item.habit;
  const target = weeklyTarget(h);
  const cadence = item.met_for_week
    ? `Done for this week (${item.week_count}/${target})`
    : `${CADENCE[h.cadence] ?? h.cadence}${target ? ` · ${item.week_count}/${target} this week` : ''}`;
  return `${cadence} · ${item.streak}-${target ? 'week' : 'day'} streak${h.note ? ` — ${h.note}` : ''}`;
}

export function Habits({ world }: { world: World }) {
  const { engine } = useSync();
  const [yesterday, setYesterday] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!world.habits.length) return null;
  const date = yesterday ? addDays(world.today, -1) : world.today;
  const items = forDay(world, date);
  const done = items.filter((i) => i.done).length;

  async function tick(item: HabitItem) {
    setProblem(null);
    try {
      await engine.enqueue(habitSet, { habit_id: item.habit.id, date, done: !item.done });
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't save that. Try again.");
    }
  }

  return (
    <Card>
      <View style={styles.spread}>
        <Text variant="h4">{yesterday ? "Yesterday's habits" : "Today's habits"}</Text>
        <View style={styles.right}>
          <Text variant="tiny" tone="muted">
            {done}/{items.length} done
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setYesterday(!yesterday)} hitSlop={6}>
            <Text variant="tiny" tone="brand" style={styles.link}>
              {yesterday ? 'Back to today' : 'Forgot yesterday?'}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.list}>
        {items.length ? (
          items.map((item) => {
            const on = item.done || item.met_for_week;
            return (
              <Pressable
                key={item.habit.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done, disabled: item.met_for_week }}
                accessibilityLabel={item.habit.name}
                disabled={item.met_for_week}
                onPress={() => tick(item)}
                style={[styles.row, on && styles.rowDone]}
              >
                <Text style={styles.emoji}>{item.habit.emoji}</Text>
                <View style={styles.text}>
                  <Text variant="small" style={styles.name}>
                    {item.habit.name}
                  </Text>
                  <Text variant="tiny" tone="muted">
                    {line(item)}
                  </Text>
                </View>
                <View style={[styles.tick, on && styles.tickOn]}>
                  <Text style={[styles.tickMark, on && { color: colors.white }]}>✓</Text>
                </View>
              </Pressable>
            );
          })
        ) : (
          <Text variant="tiny" tone="muted">
            Nothing due {yesterday ? 'yesterday' : 'today'}.
          </Text>
        )}
      </View>
      {problem ? (
        <Text variant="tiny" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  link: { fontFamily: fonts.semibold },
  list: { gap: 8, marginTop: space.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.m,
    padding: space.m,
    backgroundColor: colors.surface,
  },
  rowDone: { borderColor: colors.good, backgroundColor: colors.goodLight },
  emoji: { fontSize: 18 },
  text: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bold },
  tick: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.good, borderColor: colors.good },
  tickMark: { fontSize: 13, color: colors.ink4, fontFamily: fonts.bold },
});
