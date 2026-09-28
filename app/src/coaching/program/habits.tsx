/** The athlete's habits below the board (the old _habit_card.html): streaks, the last seven days, prescribing and stopping. */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, colors, fonts, Select, Text } from '@/ui';
import { confirm } from '@/ui/confirm';

import type { ProgramCommands } from './commands';
import { useHabits } from './queries';

const EMOJI = ['🍎', '😴', '💧', '🧘', '🚶', '🥩', '🥗', '⚖️', '💪', '📓'];
/** apps/programs/models.py Habit.Cadence */
export const CADENCES = [
  { value: 'daily', label: 'Every day' },
  { value: 'training', label: 'Training days' },
  { value: '3x', label: '3× a week' },
  { value: '5x', label: '5× a week' },
];

export function HabitsCard({ athleteId, readOnly, commands }: { athleteId: string; readOnly: boolean; commands: ProgramCommands }) {
  const habits = useHabits(athleteId);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [cadence, setCadence] = useState('daily');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function prescribe() {
    if (!name.trim()) return setProblem('Give the habit a name');
    setProblem(null);
    if (await commands.prescribeHabit({ name: name.trim(), emoji, cadence, note: note.trim() })) {
      setName('');
      setNote('');
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Text variant="h4">Habits</Text>
        <Text variant="tiny" tone="muted">
          prescribed to this athlete · ticked off in their app · last 7 days shown
        </Text>
      </View>
      {habits.data?.length ? (
        habits.data.map((h) => (
          <View key={h.id} style={styles.habit}>
            <Text style={{ fontSize: 20 }}>{h.emoji}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.semibold }}>{h.name}</Text>
              <Text variant="tiny" tone="muted">
                {CADENCES.find((c) => c.value === h.cadence)?.label ?? h.cadence} · streak {h.streak}
                {h.last_seven.at(-1)?.done ? ' · done today' : ''}
                {h.note ? ` · ${h.note}` : ''}
              </Text>
            </View>
            <View style={styles.dots} accessibilityLabel={`Last 7 days: ${h.last_seven.filter((d) => d.done).length} done`}>
              {h.last_seven.map((d) => (
                <View key={d.date} style={[styles.dot, d.done && styles.dotOn]} />
              ))}
            </View>
            {!readOnly ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Stop prescribing ${h.name}`}
                hitSlop={6}
                onPress={async () => {
                  if (await confirm(`Stop prescribing “${h.name}”?`, 'Its history is kept.', 'Stop')) commands.stopHabit(h);
                }}
              >
                <Feather name="trash-2" size={15} color={colors.ink4} />
              </Pressable>
            ) : null}
          </View>
        ))
      ) : habits.data ? (
        <Text variant="small" tone="muted">
          No habits prescribed yet — add one below, or apply a template that carries habits.
        </Text>
      ) : null}
      {!readOnly ? (
        <View style={styles.add}>
          <TextInput accessibilityLabel="Habit name" value={name} onChangeText={setName} placeholder="e.g. Eat 2 pieces of fruit" placeholderTextColor={colors.ink4} maxLength={80} style={[styles.input, { flex: 2, minWidth: 180 }]} />
          <Select compact label="Emoji" value={emoji} onChange={setEmoji} options={EMOJI.map((e) => ({ value: e, label: e }))} />
          <Select compact label="How often" value={cadence} onChange={setCadence} options={CADENCES} />
          <TextInput accessibilityLabel="Habit note" value={note} onChangeText={setNote} placeholder="Why or when (optional)" placeholderTextColor={colors.ink4} maxLength={200} style={[styles.input, { flex: 1.5, minWidth: 160 }]} />
          <Button size="sm" title="+ Prescribe habit" onPress={prescribe} />
        </View>
      ) : null}
      {problem ? (
        <Text variant="tiny" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  habit: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line2 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 9, height: 9, borderRadius: 3, backgroundColor: colors.surface3 },
  dotOn: { backgroundColor: colors.good },
  add: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.surface },
});
