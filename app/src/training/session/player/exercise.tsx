/**
 * One exercise in the player: what it is and how it went last time, the prescription banner,
 * the coach's note and demo, and its set rows. A set is saved (set.save, offline) when a box
 * is left or the set is ticked; a row that the rules refuse stays red with the reason.
 */
import { Big } from 'big.js';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { uuid7 } from '@/domain/ids';
import { banner, lastTime, measureFor, setRows, type SetRowView } from '@/domain/player';
import { prescribed } from '@/domain/sessions';
import { toKg } from '@/domain/units';
import type { LogRow, SessionExerciseRow, World } from '@/domain/world';
import { Refused, setSave } from '@/sync/actions';
import type { SyncEngine } from '@/sync/engine';
import { Chip, colors, fonts, radius, SetRow, space, Text, type Measure, type SetValues } from '@/ui';

import { RxBanner } from './banner';
import { FormVideos } from './form-videos';

const asText = (row: SetRowView): SetValues => ({
  load: row.load,
  reps: String(row.reps),
  time: String(row.time),
  rir: row.rir,
});

const number = (text: string) => /^\s*\d+(\.\d+)?\s*$/.test(text);

/** The typed values as set.save sends them: kg and seconds; anything unreadable passes as typed, for the rules to refuse. */
export function toPayload(values: SetValues, unit: 'kg' | 'lb', timeUnit: 's' | 'min') {
  const load = values.load.trim();
  const time = values.time.trim();
  const reps = values.reps.trim();
  return {
    load_kg: load === '' ? null : number(load) ? toKg(load, unit) : load,
    reps: reps === '' ? null : /^\d+$/.test(reps) ? Number(reps) : (reps as unknown as number),
    duration_seconds:
      time === '' ? null : number(time) ? Number(new Big(time).times(timeUnit === 'min' ? 60 : 1).round(0, 0).toFixed(0)) : (time as unknown as number),
    rir: values.rir === '' ? null : Number(values.rir),
  };
}

export function ExerciseBlock({
  world,
  log,
  se,
  label,
  superset,
  coach,
  editable,
  engine,
}: {
  world: World;
  log: LogRow;
  se: SessionExerciseRow;
  label: string;
  superset: boolean;
  coach: string;
  editable: boolean;
  engine: SyncEngine;
}) {
  const unit = world.athlete.units;
  const p = prescribed(se);
  const [rows, timeUnit] = setRows(world, se, p, unit);
  const measure = measureFor(world, se, p) as Measure;
  const exercise = se.exercise_id ? world.exercise.get(se.exercise_id) : undefined;
  const category = exercise?.category_id ? world.category.get(exercise.category_id)?.name : undefined;
  const last = lastTime(world, se, log, unit);
  const b = banner(p, unit);
  const [drafts, setDrafts] = useState<Record<number, SetValues>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const saved = new Map((world.setsOf.get(se.id) ?? []).map((s) => [s.set_number, s]));

  async function commit(row: SetRowView, values: SetValues, done: boolean) {
    const before = asText(row);
    const unchanged = done === row.done && (Object.keys(before) as (keyof SetValues)[]).every((k) => before[k] === values[k]);
    // Leaving an untouched box saves nothing; an untouched suggestion is only saved when ticked.
    if (unchanged) return;
    try {
      await engine.enqueue(setSave, {
        set_id: saved.get(row.number)?.id ?? uuid7(),
        session_exercise_id: se.id,
        set_number: row.number,
        ...toPayload(values, unit, timeUnit),
        done,
      });
      if (done && !row.done && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setDrafts(({ [row.number]: _, ...rest }) => rest);
      setErrors(({ [row.number]: _, ...rest }) => rest);
    } catch (error) {
      setErrors((e) => ({ ...e, [row.number]: error instanceof Refused ? error.message : "Couldn't save this set." }));
    }
  }

  const title = `${label ? `${label} · ` : ''}${se.exercise_name}`;
  return (
    <View style={[styles.block, superset && styles.superset]}>
      <Text variant="tiny" tone="muted" style={styles.head}>
        {category ? `${category.toUpperCase()} · ` : ''}
        {last ? `last: ${last}` : 'first time'}
      </Text>
      <Text variant={superset ? 'h4' : 'h3'}>{title}</Text>
      {b ? <RxBanner banner={b} /> : null}
      {p?.custom_fields.length ? (
        <View style={styles.chips}>
          {p.custom_fields.map((f, i) => (
            <Chip key={i} label={`${f.key}: ${f.value}`} />
          ))}
        </View>
      ) : null}
      {p?.note ? (
        <View style={styles.note}>
          <Text variant="small">
            <Text variant="small" style={{ fontFamily: fonts.bold }}>
              Note from {coach}:
            </Text>{' '}
            {p.note}
          </Text>
        </View>
      ) : null}
      {exercise?.youtube_url ? (
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(exercise.youtube_url!)} style={styles.demo}>
          <View style={styles.play}>
            <Text style={{ color: colors.white, fontSize: 10 }}>▶</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="small" style={{ fontFamily: fonts.bold }}>
              Watch {coach}&apos;s demo{superset ? ` · ${se.exercise_name}` : ''}
            </Text>
            <Text variant="tiny" tone="muted">
              Opens in YouTube
            </Text>
          </View>
          <Text tone="muted">↗</Text>
        </Pressable>
      ) : null}
      <View style={styles.sets}>
        {rows.map((row) => {
          const values = drafts[row.number] ?? asText(row);
          return (
            <SetRow
              key={row.number}
              number={row.number}
              label={superset && label ? `${label} ` : ''}
              unit={unit}
              measure={measure}
              timeUnit={timeUnit}
              values={values}
              placeholder={row.placeholder}
              done={row.done}
              editable={editable}
              error={Boolean(errors[row.number])}
              onChange={(next) => setDrafts((d) => ({ ...d, [row.number]: next }))}
              onCommit={(next, done) => commit(row, next, done)}
            />
          );
        })}
      </View>
      {Object.entries(errors).map(([n, message]) => (
        <Text key={n} variant="tiny" tone="bad" accessibilityRole="alert">
          Set {n}: {message}
        </Text>
      ))}
      <FormVideos world={world} se={se} coach={coach} editable={editable} />
      {exercise?.cue ? (
        <Text variant="tiny" tone="muted" style={styles.cue}>
          Cue: {exercise.cue}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s },
  superset: { borderLeftWidth: 3, borderLeftColor: colors.brandLight, paddingLeft: space.m },
  head: { fontFamily: fonts.bold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  note: { backgroundColor: colors.warnLight, borderRadius: radius.m, padding: space.m },
  demo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.m,
    padding: space.m,
  },
  play: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bad, alignItems: 'center', justifyContent: 'center' },
  sets: { gap: 8, marginTop: space.xs },
  cue: { textAlign: 'center' },
});
