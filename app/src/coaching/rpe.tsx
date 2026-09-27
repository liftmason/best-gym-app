import { StyleSheet, View } from 'react-native';

import { colors, fonts, Text } from '@/ui';

/** The mockup's .rpe-pill: red from 9, amber from 7, green below. */
export function RpePill({ rpe }: { rpe: number | null | undefined }) {
  if (!rpe) return null;
  const [bg, fg] = rpe >= 9 ? [colors.badLight, colors.bad] : rpe >= 7 ? [colors.warnLight, colors.warn] : [colors.goodLight, colors.good];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>RPE {rpe}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 11, fontFamily: fonts.bold },
});
