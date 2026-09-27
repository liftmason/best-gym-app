import { Text as RNText, type TextProps } from 'react-native';

import { colors, type as typeScale } from './theme';

type Variant = keyof typeof typeScale;
type Tone = 'ink' | 'ink2' | 'muted' | 'faint' | 'brand' | 'good' | 'warn' | 'bad' | 'white';

const tones: Record<Tone, string> = {
  ink: colors.ink,
  ink2: colors.ink2,
  muted: colors.ink3,
  faint: colors.ink4,
  brand: colors.brand,
  good: colors.good,
  warn: colors.warn,
  bad: colors.bad,
  white: colors.white,
};

/** Text in one of the mockup's styles (h1–h4, body, small, tiny, label) and tones. */
export function Text({ variant = 'body', tone = 'ink', style, ...props }: TextProps & { variant?: Variant; tone?: Tone }) {
  return <RNText {...props} style={[typeScale[variant], { color: tones[tone] }, style]} />;
}
