/** Height as two boxes, feet and inches, for athletes and gyms that use pounds (src/domain/height.ts). */
import { StyleSheet, View } from 'react-native';

import { Field } from './field';
import { space } from './theme';
import { Text } from './text';

export function HeightField({
  feet,
  inches,
  onFeet,
  onInches,
  editable = true,
  autoFocus,
  error,
}: {
  feet: string;
  inches: string;
  onFeet: (text: string) => void;
  onInches: (text: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
  error?: string | null;
}) {
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <View style={styles.half}>
          <Field label="Feet" value={feet} onChangeText={onFeet} keyboardType="number-pad" placeholder={editable ? 'e.g. 5' : ''} editable={editable} autoFocus={autoFocus} />
        </View>
        <View style={styles.half}>
          <Field label="Inches" value={inches} onChangeText={onInches} keyboardType="decimal-pad" placeholder={editable ? 'e.g. 10' : ''} editable={editable} />
        </View>
      </View>
      {error ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  row: { flexDirection: 'row', gap: space.s },
  half: { flex: 1 },
});
