/**
 * Choosing one of several things. `Segmented` is the mockup's .seg (two to five short
 * choices side by side); `Select` stands in for its <select>: the current choice, and a sheet
 * of the options when pressed (works the same with a mouse, a finger or a keyboard).
 */
import { Feather } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Sheet } from './sheet';
import { Text } from './text';
import { colors, fonts, radius } from './theme';

export type Option<T extends string> = { value: T; label: string; hint?: string; left?: ReactNode };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)} style={[styles.segItem, on && styles.segOn]}>
            <Text style={[styles.segText, on && { color: colors.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Select<T extends string>({
  options,
  value,
  onChange,
  label,
  title,
  placeholder = 'Choose…',
  disabled,
  compact,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** What it chooses, for screen readers and the sheet's title. */
  label: string;
  title?: string;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.select, compact && styles.compact, disabled && { opacity: 0.5 }]}
      >
        {current?.left}
        <Text numberOfLines={1} style={[styles.selectText, !current && { color: colors.ink4 }]}>
          {current?.label ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={15} color={colors.ink3} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={title ?? label}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: o.value === value }}
            onPress={() => {
              setOpen(false);
              if (o.value !== value) onChange(o.value);
            }}
            style={[styles.option, o.value === value && styles.optionOn]}
          >
            {o.left}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold }}>{o.label}</Text>
              {o.hint ? (
                <Text variant="tiny" tone="muted">
                  {o.hint}
                </Text>
              ) : null}
            </View>
            {o.value === value ? <Feather name="check" size={16} color={colors.brand} /> : null}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colors.surface2, borderRadius: 10, padding: 3, gap: 2 },
  segItem: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  segOn: { backgroundColor: colors.surface },
  segText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink3 },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.surface },
  compact: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.s },
  selectText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10 },
  optionOn: { backgroundColor: colors.brandLight },
});
