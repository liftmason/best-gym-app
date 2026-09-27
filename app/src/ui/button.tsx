import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Text } from './text';
import { colors, fonts, radius } from './theme';

type Variant = 'brand' | 'ghost' | 'soft' | 'good' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const looks: Record<Variant, { bg: string; border: string; text: string; pressed: string }> = {
  brand: { bg: colors.brand, border: colors.brand, text: colors.white, pressed: colors.brandDark },
  ghost: { bg: colors.surface, border: colors.line, text: colors.ink, pressed: colors.surface2 },
  soft: { bg: colors.surface2, border: colors.surface2, text: colors.ink, pressed: colors.surface3 },
  good: { bg: colors.good, border: colors.good, text: colors.white, pressed: colors.good },
  danger: { bg: colors.badLight, border: colors.badLight, text: colors.bad, pressed: colors.badLight },
};

const sizes: Record<Size, { paddingVertical: number; paddingHorizontal: number; fontSize: number; borderRadius: number }> = {
  sm: { paddingVertical: 6, paddingHorizontal: 12, fontSize: 12.5, borderRadius: 8 },
  md: { paddingVertical: 10, paddingHorizontal: 18, fontSize: 14, borderRadius: 10 },
  lg: { paddingVertical: 14, paddingHorizontal: 26, fontSize: 16, borderRadius: radius.m },
};

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
};

/** The mockup's .btn: brand, ghost, soft, good or danger; small, normal or large. */
export function Button({ title, onPress, variant = 'brand', size = 'md', block, disabled, busy, style }: Props) {
  const look = looks[variant];
  const s = sizes[size];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed ? look.pressed : look.bg,
          borderColor: look.border,
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          borderRadius: s.borderRadius,
          opacity: off ? 0.45 : 1,
        },
        block && styles.block,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={look.text} /> : null}
      <Text style={{ fontFamily: fonts.semibold, fontSize: s.fontSize, color: look.text }}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1.5 },
  block: { alignSelf: 'stretch' },
});
