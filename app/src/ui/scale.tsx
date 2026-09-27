import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, fonts } from './theme';

/** The mockup's .scale-row: 1 to 10 in two rows of five, one picked. */
export function Scale({ value, onPick, spoken }: { value: string; onPick: (value: string) => void; spoken: (n: number) => string }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => {
        const on = n === value;
        return (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={spoken(Number(n))}
            onPress={() => onPick(n)}
            style={[styles.button, on && styles.on]}
          >
            <Text style={[styles.text, on && { color: colors.white }]}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 14 },
  button: {
    width: '18.3%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { backgroundColor: colors.brand, borderColor: colors.brand, transform: [{ scale: 1.06 }] },
  text: { fontFamily: fonts.bold, fontSize: 17 },
});
