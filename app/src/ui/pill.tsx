import { View } from 'react-native';

import { Text } from './text';
import { colors, fonts, radius, weekTypeColours } from './theme';

type Tone = 'plain' | 'brand' | 'good' | 'warn' | 'bad';

const tones: Record<Tone, { bg: string; text: string }> = {
  plain: { bg: colors.surface2, text: colors.ink2 },
  brand: { bg: colors.brandLight, text: colors.brand },
  good: { bg: colors.goodLight, text: colors.good },
  warn: { bg: colors.warnLight, text: colors.warn },
  bad: { bg: colors.badLight, text: colors.bad },
};

/** The mockup's .chip: a small rounded label. */
export function Chip({ label, tone = 'plain' }: { label: string; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: t.bg, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, letterSpacing: 0.2, color: t.text }}>{label}</Text>
    </View>
  );
}

/** The mockup's .wk-pill: a week type's name with its colour swatch (colours are the gym's). */
export function WeekPill({ name, colour }: { name: string; colour: string }) {
  const c = weekTypeColours(colour);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: c.light,
        borderRadius: radius.pill,
        paddingVertical: 3,
        paddingHorizontal: 10,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.colour }} />
      <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: c.colour }}>{name}</Text>
    </View>
  );
}
