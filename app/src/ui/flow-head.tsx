import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, fonts } from './theme';

/** The mockup's .flow-head: a back or close button, a progress bar, and "2 of 5". */
export function FlowHead({
  icon,
  label,
  onBack,
  progress,
  step,
}: {
  icon: 'arrow-left' | 'x';
  label: string;
  onBack: () => void;
  progress?: number;
  step: string;
}) {
  return (
    <View style={styles.head}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onBack} style={styles.icon} hitSlop={6}>
        <Feather name={icon} size={18} color={colors.ink2} />
      </Pressable>
      {progress !== undefined ? (
        <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}>
          <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
        </View>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <Text style={styles.step}>{step}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  step: { fontSize: 12, color: colors.ink3, fontFamily: fonts.semibold },
});
