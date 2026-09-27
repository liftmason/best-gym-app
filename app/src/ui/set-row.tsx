import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from './text';
import { colors, fonts } from './theme';

export type SetValues = { load: string; reps: string; rir: string };

type Props = {
  number: number;
  asked: string; // what the coach asked for, e.g. "2 @ 80 kg"
  unit: string; // the athlete's unit, labels the load box
  values: SetValues;
  done: boolean;
  onChange: (values: SetValues) => void;
  onToggle: () => void;
  showRir?: boolean;
};

/** The mockup's .set-row: set number, what's asked, load / reps / RIR boxes, and the tick. */
export function SetRow({ number, asked, unit, values, done, onChange, onToggle, showRir = true }: Props) {
  const box = (key: keyof SetValues, label: string) => (
    <View key={key}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={`Set ${number} ${label}`}
        value={values[key]}
        onChangeText={(text) => onChange({ ...values, [key]: text })}
        keyboardType="decimal-pad"
        style={[styles.input, done && styles.inputDone]}
      />
    </View>
  );
  return (
    <View style={[styles.row, done && styles.rowDone]}>
      <View style={styles.number}>
        <Text style={styles.numberText}>{number}</Text>
      </View>
      <Text variant="small" style={styles.asked} numberOfLines={2}>
        {asked}
      </Text>
      {box('load', unit)}
      {box('reps', 'reps')}
      {showRir ? box('rir', 'rir') : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`Set ${number} done`}
        onPress={onToggle}
        hitSlop={8}
        style={[styles.tick, done && styles.tickDone]}
      >
        <Text style={{ color: done ? colors.white : 'transparent', fontFamily: fonts.bold }}>✓</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  rowDone: { borderColor: colors.good, backgroundColor: colors.goodLight },
  number: { width: 26, height: 26, borderRadius: 8, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  numberText: { fontFamily: fonts.bold, fontSize: 11.5 },
  asked: { flex: 1, fontVariant: ['tabular-nums'] },
  label: { fontSize: 9, color: colors.ink4, textTransform: 'uppercase', textAlign: 'center', fontFamily: fonts.bold, marginBottom: 2 },
  input: {
    width: 58,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 8,
    fontSize: 13,
    textAlign: 'center',
    backgroundColor: colors.surface,
    fontFamily: fonts.medium,
    color: colors.ink,
  },
  inputDone: { borderColor: colors.good },
  tick: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickDone: { backgroundColor: colors.good, borderColor: colors.good },
});
