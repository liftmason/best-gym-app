import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import type { WeekTypeRow } from '@/domain/world';
import { colors, Text, WeekPill } from '@/ui';

/** "Wk 2 · Sep 21–27", arrows to the weeks either side, and the week type's pill. */
export function WeekHeader({
  label,
  weekType,
  onPrevious,
  onNext,
}: {
  label: string;
  weekType?: WeekTypeRow;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const arrow = (name: 'chevron-left' | 'chevron-right', label: string, onPress?: () => void) =>
    onPress ? (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.arrow} hitSlop={6}>
        <Feather name={name} size={16} color={colors.ink2} />
      </Pressable>
    ) : null;
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        {arrow('chevron-left', 'Previous week', onPrevious)}
        <Text variant="h4">{label}</Text>
        {arrow('chevron-right', 'Next week', onNext)}
      </View>
      {weekType ? <WeekPill name={weekType.name} colour={weekType.colour} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  left: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrow: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
});
