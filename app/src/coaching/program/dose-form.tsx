/**
 * The dose fields (the old _dose_fields.html), shared by the board's prescription editor and
 * the template editor's slots. The server checks everything (apps/programs/dose.py); errors
 * come back keyed by field and show under it.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, colors, Field, fonts, Segmented, Text } from '@/ui';

import type { Dose } from './queries';

export const LOAD_BASES = [
  { value: 'percent', label: '% of max' },
  { value: 'rpe', label: 'RPE' },
  { value: 'weight', label: 'Weight' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'none', label: 'No load' },
] as const;
type Basis = (typeof LOAD_BASES)[number]['value'];

const MAX_SETS = 20;
const MAX_CUSTOM = 8;

/** Per-set rows follow the main fields until edited: resize them to `sets`, filling new rows from the main reps and load. */
export function fitRows(dose: Dose, sets: number): Dose['set_rows'] {
  const rows = dose.set_rows.slice(0, sets);
  while (rows.length < sets) rows.push({ reps: dose.rep_scheme, load: dose.load_value });
  return rows;
}

function Check({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} style={styles.check}>
      <View style={[styles.box, on && styles.boxOn]}>{on ? <Feather name="check" size={12} color={colors.white} /> : null}</View>
      <Text variant="small" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function DoseFields({ dose, onChange, errors, unit }: { dose: Dose; onChange: (dose: Dose) => void; errors: Record<string, string>; unit: string }) {
  const set = (patch: Partial<Dose>) => onChange({ ...dose, ...patch });
  const basis = dose.load_basis as Basis;
  const hasLoad = basis === 'percent' || basis === 'rpe' || basis === 'weight';
  const loadUnit = basis === 'percent' ? '% of max' : basis === 'rpe' ? 'RPE' : unit;

  if (dose.warmup) {
    return (
      <View style={styles.gap}>
        <Check on label="Warm-up drill — ticked off in the warm-up checklist at the start of the session, nothing to log" onPress={() => set({ warmup: false })} />
        <Field label="Dose" value={dose.rep_scheme} onChangeText={(rep_scheme) => set({ rep_scheme })} placeholder="e.g. x 5 breaths + 5 shifts, 5 min" maxLength={60} error={errors.rep_scheme} />
        <Field label="Note to athlete" value={dose.note} onChangeText={(note) => set({ note })} placeholder="e.g. pause 2s in the catch" maxLength={500} multiline error={errors.note} />
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      <Check on={false} label="Warm-up drill — ticked off in the warm-up checklist at the start of the session, nothing to log" onPress={() => set({ warmup: true, superset: false, section: '', section_note: '' })} />
      <View style={styles.row}>
        <View style={{ width: 90 }}>
          <Field
            label="Sets"
            keyboardType="number-pad"
            value={dose.sets ? String(dose.sets) : ''}
            onChangeText={(text) => {
              const sets = Math.min(MAX_SETS, Math.max(0, parseInt(text.replace(/\D/g, ''), 10) || 0));
              set({ sets, set_rows: dose.vary ? fitRows(dose, sets) : dose.set_rows });
            }}
            error={errors.sets}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Reps" value={dose.rep_scheme} onChangeText={(rep_scheme) => set({ rep_scheme })} placeholder="5, 10-12, 8/leg, 10 min" maxLength={60} hint="e.g. 5, 10-12, 1+1, 8/leg, 10 min, AMRAP" error={errors.rep_scheme} />
        </View>
        <View style={{ width: 110 }}>
          <Field label="RIR target" value={dose.rir} onChangeText={(rir) => set({ rir })} placeholder="2 or 1-2" maxLength={5} error={errors.rir} />
        </View>
      </View>
      <View style={styles.gapS}>
        <Text variant="label" tone="ink2">
          Load basis
        </Text>
        <Segmented label="Load basis" options={LOAD_BASES.map((b) => ({ ...b }))} value={basis} onChange={(load_basis) => set({ load_basis })} />
        {errors.load_basis ? (
          <Text variant="tiny" tone="bad">
            {errors.load_basis}
          </Text>
        ) : null}
      </View>
      {hasLoad ? (
        <View style={{ maxWidth: 200 }}>
          <Field label={`Load (${loadUnit})`} keyboardType="decimal-pad" value={dose.load_value} onChangeText={(load_value) => set({ load_value })} error={errors.load_value} />
        </View>
      ) : null}
      <Field label="Note to athlete" value={dose.note} onChangeText={(note) => set({ note })} placeholder="e.g. pause 2s in the catch" maxLength={500} multiline error={errors.note} />

      <Check on={dose.vary} label="Vary by set — e.g. 70 / 75 / 80%, or 5-3-1 reps" onPress={() => set({ vary: !dose.vary, set_rows: !dose.vary ? fitRows({ ...dose, set_rows: [] }, dose.sets) : dose.set_rows })} />
      {dose.vary ? (
        <View style={styles.gapS}>
          {fitRows(dose, dose.sets).map((row, i) => (
            <View key={i} style={styles.setRow}>
              <Text style={styles.setLabel}>Set {i + 1}</Text>
              <TextInput
                accessibilityLabel={`Set ${i + 1} reps`}
                value={row.reps}
                onChangeText={(reps) => set({ set_rows: fitRows(dose, dose.sets).map((r, j) => (j === i ? { ...r, reps } : r)) })}
                placeholder="reps"
                placeholderTextColor={colors.ink4}
                style={styles.small}
              />
              {hasLoad ? (
                <TextInput
                  accessibilityLabel={`Set ${i + 1} load`}
                  value={row.load}
                  onChangeText={(load) => set({ set_rows: fitRows(dose, dose.sets).map((r, j) => (j === i ? { ...r, load } : r)) })}
                  placeholder={loadUnit}
                  placeholderTextColor={colors.ink4}
                  keyboardType="decimal-pad"
                  style={styles.small}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Section heading above this (optional)" value={dose.section} onChangeText={(section) => set({ section })} placeholder="e.g. Strength, Hypertrophy" maxLength={40} error={errors.section} />
        </View>
        <View style={{ flex: 1.4 }}>
          <Field label="Section note" value={dose.section_note} onChangeText={(section_note) => set({ section_note })} placeholder="e.g. Superset non-competing exercises when available" maxLength={200} error={errors.section_note} />
        </View>
      </View>
      <Check on={dose.superset} label="Superset with the exercise above — shown as A1 / A2; the athlete logs them on one screen" onPress={() => set({ superset: !dose.superset })} />

      <View style={styles.gapS}>
        <Text variant="label" tone="ink2">
          Custom fields <Text variant="tiny" tone="muted">anything else — tempo, rest, bar, cue</Text>
        </Text>
        {dose.custom_fields.map((f, i) => (
          <View key={i} style={styles.setRow}>
            <TextInput
              accessibilityLabel={`Custom field ${i + 1} name`}
              value={f.key}
              onChangeText={(key) => set({ custom_fields: dose.custom_fields.map((c, j) => (j === i ? { ...c, key } : c)) })}
              placeholder="Field (e.g. Tempo)"
              placeholderTextColor={colors.ink4}
              maxLength={30}
              style={[styles.small, { flex: 1 }]}
            />
            <TextInput
              accessibilityLabel={`Custom field ${i + 1} value`}
              value={f.value}
              onChangeText={(value) => set({ custom_fields: dose.custom_fields.map((c, j) => (j === i ? { ...c, value } : c)) })}
              placeholder="Value (e.g. 3-1-0)"
              placeholderTextColor={colors.ink4}
              maxLength={60}
              style={[styles.small, { flex: 1.3 }]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove custom field ${i + 1}`} onPress={() => set({ custom_fields: dose.custom_fields.filter((_, j) => j !== i) })} hitSlop={6}>
              <Feather name="x" size={15} color={colors.ink3} />
            </Pressable>
          </View>
        ))}
        {dose.custom_fields.length < MAX_CUSTOM ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button size="sm" variant="ghost" title="+ add field" onPress={() => set({ custom_fields: [...dose.custom_fields, { key: '', value: '' }] })} />
          </View>
        ) : null}
      </View>
      {errors[''] ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {errors['']}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 14 },
  gapS: { gap: 8 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: colors.ink4, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setLabel: { width: 48, fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink3 },
  small: { width: 110, borderWidth: 1.5, borderColor: colors.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.surface },
});
