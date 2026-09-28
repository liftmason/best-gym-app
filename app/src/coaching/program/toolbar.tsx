/**
 * The week's toolbar: its dates and whether the athlete sees it, undo, its type, the week
 * actions, publishing, and the coach's focus note (shown on the athlete's home screen).
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { addDays } from '@/domain/world';
import { dayMonth } from '@/training/format';
import { Button, Card, Chip, colors, fonts, Select, Text, weekTypeColours } from '@/ui';
import { confirm } from '@/ui/confirm';

import type { ProgramCommands } from './commands';
import type { Week, WeekTypeRef } from './queries';

type Props = {
  week: Week;
  weekTypes: WeekTypeRef[];
  first: string;
  commands: ProgramCommands;
  onSave: () => void;
  readOnly: boolean;
};

export function WeekToolbar({ week, weekTypes, first, commands, onSave, readOnly }: Props) {
  const hasSessions = week.days.some((d) => d.sessions.length);

  async function clear() {
    const more = week.published ? ` ${first} will see the empty week straight away.` : '';
    if (await confirm(`Remove every session from ${week.label}?`, `Days with a completed session are kept.${more}`, 'Clear week')) commands.clearWeek(week);
  }
  async function remove() {
    if (await confirm(`Delete ${week.label} and everything in it?`, 'Later weeks move up a week to close the gap.', 'Delete week')) commands.deleteWeek(week);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={{ gap: 4, flexShrink: 1 }}>
          <Text variant="h4">
            {week.label} · {dayMonth(week.start_date)}–{dayMonth(addDays(week.start_date, 6))}
          </Text>
          <Chip tone={week.published ? 'good' : 'warn'} label={week.published ? `Live — ${first} sees edits immediately` : `Draft — not visible to ${first}`} />
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={week.undo ? `Undo: ${week.undo}` : 'Nothing to undo in this week yet'}
            accessibilityState={{ disabled: !week.undo || readOnly }}
            disabled={!week.undo || readOnly}
            onPress={() => commands.undo(week)}
            style={[styles.undo, (!week.undo || readOnly) && { opacity: 0.45 }]}
          >
            <Feather name="corner-up-left" size={14} color={colors.ink2} />
            <Text style={styles.undoText} numberOfLines={1}>
              {week.undo ? `Undo: ${week.undo}` : 'Undo'}
            </Text>
          </Pressable>
          <Select
            compact
            label="Week type"
            disabled={readOnly}
            value={week.week_type?.id ?? null}
            options={weekTypes.map((t) => ({ value: t.id, label: t.name, left: <View style={[styles.swatch, { backgroundColor: weekTypeColours(t.colour).colour }]} /> }))}
            onChange={(value) => {
              const type = weekTypes.find((t) => t.id === value);
              if (type) commands.setWeekType(week, type);
            }}
          />
        </View>
      </View>
      <View style={styles.buttons}>
        <Button size="sm" variant="ghost" title="Duplicate week" disabled={readOnly} onPress={() => commands.duplicateWeek(week)} />
        <Button size="sm" variant="ghost" title="Save week" disabled={readOnly || !hasSessions} onPress={onSave} />
        <Button size="sm" variant="ghost" title="Clear week" disabled={readOnly || !hasSessions} onPress={clear} />
        <Button size="sm" variant="ghost" title="Delete week" disabled={readOnly} onPress={remove} />
        <View style={{ flex: 1 }} />
        {week.published ? (
          <Button size="sm" variant="soft" title="Unpublish" disabled={readOnly} onPress={() => commands.publish(week, false)} />
        ) : (
          <Button size="sm" variant="good" title={`Publish to ${first}`} disabled={readOnly} onPress={() => commands.publish(week, true)} />
        )}
      </View>
      <FocusNote key={`${week.id}:${week.focus_note}`} saved={week.focus_note} first={first} readOnly={readOnly} onSave={(note) => commands.setFocusNote(week, note)} />
    </Card>
  );
}

/** Keyed on the saved note, so a new week or a saved change starts it afresh. */
function FocusNote({ saved, first, readOnly, onSave }: { saved: string; first: string; readOnly: boolean; onSave: (note: string) => void }) {
  const [focus, setFocus] = useState(saved);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="ink2">
        Coach&apos;s focus this week — shown on {first}&apos;s home screen
      </Text>
      <TextInput
        accessibilityLabel="Focus this week"
        editable={!readOnly}
        value={focus}
        onChangeText={setFocus}
        onBlur={() => focus.trim() !== saved && onSave(focus.trim())}
        placeholder="e.g. Openers Saturday. Keep every snatch above 90% crisp."
        placeholderTextColor={colors.ink4}
        maxLength={1000}
        style={styles.focus}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  top: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 240, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  undoText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2, flexShrink: 1 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  focus: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, fontSize: 14, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.surface },
});
