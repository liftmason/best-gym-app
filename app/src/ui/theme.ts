/**
 * The design tokens from the mockup (mockup/index.html, `:root`), for React Native styles.
 * The mockup is the visual reference: change a value there first, then here.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  bg: '#F4F5F7',
  surface: '#FFFFFF',
  surface2: '#EDEFF2',
  surface3: '#E2E5EA',
  ink: '#14181F',
  ink2: '#3D444F',
  ink3: '#6B7280',
  ink4: '#9CA3AF',
  line: '#E2E5EA',
  line2: '#EDEFF2',
  brand: '#1F4FD8',
  brandDark: '#173CA8',
  brandLight: '#E4EBFC',
  good: '#159570',
  goodLight: '#DCF3EC',
  warn: '#D97706',
  warnLight: '#FCEEDB',
  bad: '#DC3545',
  badLight: '#FBE3E6',
  white: '#FFFFFF',
  scrim: 'rgba(16,20,26,0.45)',
} as const;

export const radius = { s: 8, m: 12, l: 18, xl: 26, pill: 999 } as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 22, xxl: 32 } as const;

/** Inter at each weight the mockup uses (React Native needs one family per weight). */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

/** The mockup's type scale (body 15 px; headings tighter). */
export const type: Record<'h1' | 'h2' | 'h3' | 'h4' | 'body' | 'small' | 'tiny' | 'label', TextStyle> = {
  h1: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.45 },
  h2: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 27, letterSpacing: -0.3 },
  h3: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 21, letterSpacing: -0.25 },
  h4: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  tiny: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
};

/** The mockup's shadows (--sh-1, -2, -3), as iOS shadows, Android elevation and web boxShadow. */
function shadow(css: string, elevation: number, opacity: number, radiusPx: number, y: number): ViewStyle {
  return Platform.select<ViewStyle>({
    web: { boxShadow: css } as ViewStyle,
    android: { elevation },
    default: { shadowColor: '#14181F', shadowOpacity: opacity, shadowRadius: radiusPx, shadowOffset: { width: 0, height: y } },
  });
}

export const shadows = {
  s1: shadow('0 1px 2px rgba(20,24,31,.05),0 2px 8px rgba(20,24,31,.05)', 1, 0.06, 8, 2),
  s2: shadow('0 4px 14px rgba(20,24,31,.08),0 12px 32px rgba(20,24,31,.08)', 4, 0.1, 24, 8),
  s3: shadow('0 18px 60px rgba(20,24,31,.22)', 12, 0.22, 40, 18),
};

/**
 * A week type's colours. Gyms pick their own week types and colours (the API sends the hex),
 * so the light tint is worked out: the colour mixed 16% into white, which comes within a few
 * steps of the tints the mockup picked by hand for its week types.
 */
export function weekTypeColours(hex: string): { colour: string; light: string } {
  const n = parseInt(hex.replace('#', ''), 16);
  const mix = (channel: number) => Math.round(channel * 0.16 + 255 * 0.84);
  const light = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return { colour: hex, light: `#${light.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}` };
}
