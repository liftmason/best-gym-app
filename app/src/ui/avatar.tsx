import { StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, fonts } from './theme';

/** Initials in a circle ("MT" for Maya Torres), the mockup's .avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden>
      <Text style={[styles.text, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.brandLight, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.bold, color: colors.brand },
});
