import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './text';
import { colors, fonts } from './theme';

type Props = TextInputProps & { label: string; error?: string | null; hint?: string };

/** The mockup's .field: a label, an input with the brand focus ring, and an error line. */
export function Field({ label, error, hint, style, onFocus, onBlur, ...input }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="ink2">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.ink4}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            borderWidth: 1.5,
            borderColor: error ? colors.bad : focused ? colors.brand : colors.line,
            backgroundColor: colors.surface,
            borderRadius: 10,
            paddingVertical: 9,
            paddingHorizontal: 12,
            fontSize: 14.5,
            fontFamily: fonts.regular,
            color: colors.ink,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="tiny" tone="bad" accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="tiny" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
