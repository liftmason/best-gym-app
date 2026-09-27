/**
 * The mockup's .set-row: the set's number, its boxes (load, then reps and RIR, or time), and
 * the tick. Values are text as typed; the screen saves them when a box is left or the set is
 * ticked (onCommit), not on every keystroke.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Sheet } from './sheet';
import { Text } from './text';
import { colors, fonts } from './theme';

export type SetValues = { load: string; reps: string; time: string; rir: string };
export type Measure = 'reps' | 'time' | 'distance';

export const RIR_CHOICES: [string, string][] = [
  ['', '—'],
  ['0', '0'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
  ['5', '5+'],
];

type Props = {
  number: number;
  /** "A1 " in a superset, so each row says whose set it is. */
  label?: string;
  unit: string;
  measure: Measure;
  timeUnit: 's' | 'min';
  values: SetValues;
  placeholder: string;
  done: boolean;
  editable: boolean;
  /** Didn't save: shown in red until the next change. */
  error?: boolean;
  onChange: (values: SetValues) => void;
  onCommit: (values: SetValues, done: boolean) => void;
};

export function SetRow({ number, label = '', unit, measure, timeUnit, values, placeholder, done, editable, error, onChange, onCommit }: Props) {
  const [picking, setPicking] = useState(false);
  const who = `${label}Set ${number}`;
  const box = (key: 'load' | 'reps' | 'time', caption: string, spoken: string, keyboard: 'decimal-pad' | 'number-pad', hint = '') => (
    <View key={key}>
      <Text style={styles.label}>{caption}</Text>
      <TextInput
        accessibilityLabel={`${who} ${spoken}`}
        value={values[key]}
        placeholder={hint}
        placeholderTextColor={colors.ink4}
        editable={editable}
        onChangeText={(text) => onChange({ ...values, [key]: text })}
        onEndEditing={() => onCommit(values, done)}
        onBlur={() => onCommit(values, done)}
        keyboardType={keyboard}
        style={[styles.input, done && styles.inputDone, error && styles.inputError, !editable && styles.inputOff]}
      />
    </View>
  );
  const rirLabel = RIR_CHOICES.find(([v]) => v === values.rir)?.[1] ?? '—';
  return (
    <View style={[styles.row, done && styles.rowDone, error && styles.rowError]}>
      <View style={styles.number}>
        <Text style={styles.numberText}>{number}</Text>
      </View>
      {box('load', unit, `load in ${unit}`, 'decimal-pad', unit)}
      {measure === 'reps' ? box('reps', 'reps', 'reps', 'number-pad', placeholder) : null}
      {measure === 'time' ? box('time', timeUnit, `time in ${timeUnit === 'min' ? 'minutes' : 'seconds'}`, 'decimal-pad', placeholder) : null}
      {measure === 'reps' ? (
        <View>
          <Text style={styles.label}>RIR</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${who} reps in reserve: ${rirLabel}`}
            disabled={!editable}
            onPress={() => setPicking(true)}
            style={[styles.input, styles.select, done && styles.inputDone, !editable && styles.inputOff]}
          >
            <Text style={styles.selectText}>{rirLabel}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.spacer} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: !editable }}
        accessibilityLabel={`Mark ${label}set ${number} done`}
        disabled={!editable}
        onPress={() => onCommit(values, !done)}
        hitSlop={8}
        style={[styles.tick, done && styles.tickDone]}
      >
        <Text style={{ color: done ? colors.white : colors.ink4, fontFamily: fonts.bold }}>✓</Text>
      </Pressable>
      <Sheet open={picking} onClose={() => setPicking(false)} title={`${who}: reps in reserve`}>
        <View style={styles.choices}>
          {RIR_CHOICES.map(([value, text]) => (
            <Pressable
              key={value || 'none'}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === values.rir }}
              accessibilityLabel={value ? `RIR ${text}` : 'No RIR'}
              onPress={() => {
                setPicking(false);
                const next = { ...values, rir: value };
                onChange(next);
                onCommit(next, done);
              }}
              style={[styles.choice, value === values.rir && styles.choiceOn]}
            >
              <Text style={[styles.choiceText, value === values.rir && { color: colors.white }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  rowDone: { borderColor: colors.good, backgroundColor: colors.goodLight },
  rowError: { borderColor: colors.bad },
  number: { width: 26, height: 26, borderRadius: 8, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  numberText: { fontFamily: fonts.bold, fontSize: 11.5 },
  label: { fontSize: 9, color: colors.ink4, textTransform: 'uppercase', textAlign: 'center', fontFamily: fonts.bold, marginBottom: 2 },
  input: {
    width: 62,
    height: 36,
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 8,
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: colors.surface,
    fontFamily: fonts.medium,
    color: colors.ink,
  },
  inputDone: { borderColor: colors.good },
  inputError: { borderColor: colors.bad },
  inputOff: { backgroundColor: colors.surface2, color: colors.ink3 },
  select: { width: 48, alignItems: 'center', justifyContent: 'center' },
  selectText: { fontFamily: fonts.medium, fontSize: 14 },
  spacer: { flex: 1 },
  tick: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickDone: { backgroundColor: colors.good, borderColor: colors.good },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  choice: { minWidth: 52, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center' },
  choiceOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  choiceText: { fontFamily: fonts.bold, fontSize: 15 },
});
