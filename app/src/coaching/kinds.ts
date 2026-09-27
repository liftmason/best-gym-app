/** How each attention-feed kind looks (the mockup's .attn--KIND icons and tints). */
import type { Feather } from '@expo/vector-icons';

import { colors } from '@/ui';

export const GRAPE = '#7B4FD8';
export const GRAPE_LIGHT = '#EFE7FB';

type Look = { icon: keyof typeof Feather.glyphMap; colour: string; tint: string; label: string };

export const KINDS: Record<string, Look> = {
  issue: { icon: 'alert-triangle', colour: colors.bad, tint: colors.badLight, label: 'Issue reported' },
  message: { icon: 'message-circle', colour: colors.brand, tint: colors.brandLight, label: 'Unread message' },
  video: { icon: 'video', colour: GRAPE, tint: GRAPE_LIGHT, label: 'Form video to review' },
  pr: { icon: 'award', colour: colors.good, tint: colors.goodLight, label: 'PR' },
  program_ending: { icon: 'calendar', colour: colors.warn, tint: colors.warnLight, label: 'Needs programming' },
  missed: { icon: 'x-circle', colour: colors.warn, tint: colors.warnLight, label: 'Missed session' },
  metrics_missing: { icon: 'clipboard', colour: colors.warn, tint: colors.warnLight, label: 'Missing metrics' },
  week_published: { icon: 'check-circle', colour: colors.good, tint: colors.goodLight, label: 'Week published' },
};

export const look = (kind: string): Look => KINDS[kind] ?? { icon: 'bell', colour: colors.ink3, tint: colors.surface2, label: kind };
