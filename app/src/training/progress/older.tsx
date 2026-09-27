/**
 * Sessions from before the phone's 12 months, fetched a page at a time (GET /me/history,
 * online only), and a read-only look at one.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { setsText } from '@/domain/history';
import type { Unit } from '@/domain/units';
import type { LogRow, SessionExerciseRow, SetRow } from '@/domain/world';
import { Button, colors, fonts, radius, Sheet, space, Text } from '@/ui';

import { dayMonth } from '../format';

type Page = { tables: Record<string, Record<string, unknown>[]>; next: string | null };
type Older = { log: LogRow; exercises: { name: string; sets: string }[] };

function read(page: Page, unit: Unit): Older[] {
  const rows = <T,>(t: string) => (page.tables[t] ?? []) as unknown as T[];
  const sets = rows<SetRow>('workouts_setlog');
  const exercises = rows<SessionExerciseRow>('workouts_sessionexercise');
  return rows<LogRow>('workouts_sessionlog').map((log) => ({
    log,
    exercises: exercises
      .filter((se) => se.session_log_id === log.id && !se.warmup)
      .sort((a, b) => a.order - b.order)
      .map((se) => ({
        name: se.exercise_name,
        sets: setsText(sets.filter((s) => s.session_exercise_id === se.id && s.done).sort((a, b) => a.set_number - b.set_number), unit),
      })),
  }));
}

export function OlderSessions({ unit, historyFrom }: { unit: Unit; historyFrom: string | null }) {
  const [items, setItems] = useState<Older[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<Older | null>(null);
  if (!historyFrom) return null;

  async function load() {
    setBusy(true);
    setProblem(null);
    try {
      const page = (await ok(api.client.GET('/api/v1/me/history', { params: { query: { before: next ?? '' } } }))) as Page;
      setItems((list) => [...list, ...read(page, unit)]);
      setNext(page.next);
    } catch (error) {
      setProblem(error instanceof ApiError && error.offline ? 'Older sessions need a connection.' : "Couldn't load them. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <Pressable key={item.log.id} accessibilityRole="button" onPress={() => setOpen(item)} style={styles.row}>
          <Text variant="small" style={{ fontFamily: fonts.bold }}>
            {dayMonth(item.log.date)}
          </Text>
          <Text variant="tiny" tone="muted" numberOfLines={1}>
            {item.log.name}
            {item.log.session_rpe ? ` · RPE ${item.log.session_rpe}` : ''}
          </Text>
        </Pressable>
      ))}
      {items.length && next === null ? (
        <Text variant="tiny" tone="muted" style={styles.centred}>
          That&apos;s everything.
        </Text>
      ) : (
        <Button title={items.length ? 'Load more' : 'Load older sessions'} variant="ghost" busy={busy} onPress={load} />
      )}
      {problem ? (
        <Text variant="tiny" tone="bad" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? `${dayMonth(open.log.date)} · ${open.log.name}` : ''}>
        {open?.exercises.map((e, i) => (
          <View key={i} style={styles.exercise}>
            <Text variant="small" style={{ fontFamily: fonts.bold }}>
              {e.name}
            </Text>
            <Text variant="tiny" tone="muted">
              {e.sets || 'nothing logged'}
            </Text>
          </View>
        ))}
        {open?.log.comment ? <Text variant="small">“{open.log.comment}”</Text> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.m, padding: space.m },
  centred: { textAlign: 'center' },
  exercise: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line2 },
});
