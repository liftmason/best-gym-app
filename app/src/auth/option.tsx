/** One choice in a list (units, starter pack): a bordered row that shows when it's picked. */
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, space, Text } from '@/ui';

type Props = { title: string; detail?: string; selected: boolean; onPress: () => void };

export function Option({ title, detail, selected, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.option, selected && styles.selected]}
    >
      <View style={[styles.dot, selected && styles.dotOn]} />
      <View style={styles.text}>
        <Text variant="h4">{title}</Text>
        {detail ? (
          <Text variant="tiny" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.l,
    padding: 14,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.ink4 },
  dotOn: { borderColor: colors.brand, borderWidth: 6 },
  text: { flex: 1, gap: 2 },
});
