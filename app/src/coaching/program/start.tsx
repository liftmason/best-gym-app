/**
 * Starting a program (the old _start_form.html): a block of back-to-back weeks from a chosen
 * week. Weeks begin on the gym's first day of the week, so the choice is a week, not a date.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { addDays, weekday } from '@/domain/world';
import { dayMonth } from '@/training/format';
import { Button, Card, Field, Select, Text } from '@/ui';

import type { ProgramCommands } from './commands';
import type { WeekTypeRef } from './queries';

/** The first day of the week `date` is in, for a gym whose weeks start on `weekStart` (0 = Monday). */
export function weekOf(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

export function StartProgram({
  first,
  today,
  weekStart,
  weekTypes,
  hadOne,
  commands,
  onDone,
}: {
  first: string;
  today: string;
  weekStart: number;
  weekTypes: WeekTypeRef[];
  hadOne: boolean;
  commands: ProgramCommands;
  onDone?: () => void;
}) {
  const thisWeek = weekOf(today, weekStart);
  const starts = useMemo(
    () =>
      [-1, 0, 1, 2, 3, 4, 5, 6].map((n) => {
        const start = addDays(thisWeek, n * 7);
        const when = n === -1 ? 'Last week' : n === 0 ? 'This week' : n === 1 ? 'Next week' : `In ${n} weeks`;
        return { value: start, label: `${when} (${dayMonth(start)})` };
      }),
    [thisWeek],
  );
  const [name, setName] = useState('');
  const [start, setStart] = useState(starts[1].value); // this week
  const [weeks, setWeeks] = useState('4');
  const [type, setType] = useState<string | null>(weekTypes[0]?.id ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function go() {
    const n = parseInt(weeks, 10);
    const problems: Record<string, string> = {};
    if (!name.trim() || name.trim().length > 80) problems.name = 'Give the block a name of up to 80 characters.';
    if (!(n >= 1 && n <= 52)) problems.weeks = 'Between 1 and 52 weeks.';
    if (!type) problems.type = weekTypes.length ? 'Pick one of your week types.' : 'Add a week type in Settings first';
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    const started = await commands.start({ name: name.trim(), first_day: start, weeks: n, week_type_id: type! }, hadOne);
    setBusy(false);
    if (started) onDone?.();
  }

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text variant="h3">{hadOne ? `Start a new program for ${first}` : `Start a program for ${first}`}</Text>
        <Text variant="small" tone="muted">
          A program is a block of back-to-back weeks. You can add, duplicate or delete weeks and change each week&apos;s type later.
        </Text>
        {hadOne ? (
          <Text variant="small" tone="warn">
            Starting a new program ends the current one. It&apos;s kept in {first}&apos;s history.
          </Text>
        ) : null}
      </View>
      <View style={styles.row}>
        <View style={{ flex: 2, minWidth: 220 }}>
          <Field label="Block name" value={name} onChangeText={setName} placeholder="e.g. Accumulation Block" maxLength={80} error={errors.name} />
        </View>
        <View style={{ width: 110 }}>
          <Field label="Weeks" keyboardType="number-pad" value={weeks} onChangeText={setWeeks} maxLength={2} error={errors.weeks} />
        </View>
      </View>
      <View style={styles.row}>
        <View style={{ gap: 6, flex: 1, minWidth: 220 }}>
          <Text variant="label" tone="ink2">
            Starts
          </Text>
          <Select label="Starts" value={start} onChange={setStart} options={starts} />
        </View>
        <View style={{ gap: 6, flex: 1, minWidth: 220 }}>
          <Text variant="label" tone="ink2">
            Week type
          </Text>
          <Select label="Week type" value={type} onChange={setType} options={weekTypes.map((t) => ({ value: t.id, label: t.name }))} placeholder="Pick a week type" />
          {errors.type ? (
            <Text variant="tiny" tone="bad">
              {errors.type}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button title="Start program" busy={busy} onPress={go} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
