/**
 * The program's weeks (the mockup's #monthStrip): one tab per week in its type's colour, with
 * "live" when published and "this week"; then the three ways to add weeks. While a template's
 * preview is open, real weeks it would replace or push later are marked, and its new weeks
 * follow as dashed tabs.
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { addDays } from '@/domain/world';
import { range } from '@/training/format';
import { colors, fonts, radius, Text, weekTypeColours } from '@/ui';

import type { WeekSummary, WeekTypeRef } from './queries';

export type Ghost = { label: string; start: string; week_type: WeekTypeRef | null; sessions: number };

type Props = {
  weeks: WeekSummary[];
  current: string | null;
  today: string;
  onPick: (weekId: string) => void;
  onTemplate: () => void;
  onSavedWeek: () => void;
  onBlank: () => void;
  locked?: boolean;
  /** The apply preview: what happens to real weeks, the new ones, and which is shown. */
  preview?: { fate: Record<string, 'replaced' | 'moves after'>; ghosts: Ghost[]; shown: number | null; onShow: (index: number) => void };
};

export function WeekTabs({ weeks, current, today, onPick, onTemplate, onSavedWeek, onBlank, locked, preview }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {weeks.map((w) => {
        const tone = weekTypeColours(w.week_type?.colour ?? colors.ink4);
        const end = addDays(w.start_date, 6);
        const thisWeek = w.start_date <= today && today <= end;
        const fate = preview?.fate[w.id];
        const selected = w.id === current && (preview?.shown ?? null) === null;
        return (
          <Pressable
            key={w.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${w.label}, ${w.week_type?.name ?? 'no type'}, ${range(w.start_date, end)}${w.published ? ', live' : ', draft'}`}
            onPress={() => onPick(w.id)}
            style={[styles.tab, { borderTopColor: tone.colour }, selected && { backgroundColor: tone.light, borderColor: tone.colour }, fate && styles.faded]}
          >
            <View style={styles.row}>
              <Text style={[styles.type, { color: tone.colour }]} numberOfLines={1}>
                {w.week_type?.name ?? 'Week'}
              </Text>
              {w.published ? <Text style={styles.live}>live</Text> : null}
            </View>
            <Text style={[styles.label, fate === 'replaced' && styles.struck]}>{w.label}</Text>
            <Text variant="tiny" tone="muted" numberOfLines={1}>
              {range(w.start_date, end)}
              {thisWeek ? ' · this week' : ''}
              {fate ? ` · ${fate}` : ''}
            </Text>
          </Pressable>
        );
      })}
      {preview?.ghosts.map((g, i) => {
        const tone = weekTypeColours(g.week_type?.colour ?? colors.ink4);
        return (
          <Pressable
            key={`ghost-${i}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: preview.shown === i }}
            accessibilityLabel={`New ${g.label}, ${g.sessions} sessions`}
            onPress={() => preview.onShow(i)}
            style={[styles.tab, styles.ghost, { borderColor: tone.colour }, preview.shown === i && { backgroundColor: tone.light }]}
          >
            <Text style={[styles.type, { color: tone.colour }]}>{g.week_type?.name ?? 'Week'} · new</Text>
            <Text style={styles.label}>{g.label}</Text>
            <Text variant="tiny" tone="muted">
              {g.sessions} session{g.sessions === 1 ? '' : 's'}
            </Text>
          </Pressable>
        );
      })}
      {!preview ? (
        <>
          <AddTab title="+ Template" line="Add from template" hint="preview, then confirm" onPress={onTemplate} disabled={locked} />
          <AddTab title="+ Saved week" line="Add a saved week" hint="preview, then confirm" onPress={onSavedWeek} disabled={locked} />
          <AddTab title="+ Week" line="Add a week" hint="at the end, same type" onPress={onBlank} disabled={locked} />
        </>
      ) : null}
    </ScrollView>
  );
}

function AddTab({ title, line, hint, onPress, disabled }: { title: string; line: string; hint: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={line} disabled={disabled} onPress={onPress} style={[styles.tab, styles.add, disabled && { opacity: 0.45 }]}>
      <Text style={[styles.type, { color: colors.brand }]}>{title}</Text>
      <Text style={styles.label}>{line}</Text>
      <Text variant="tiny" tone="muted">
        {hint}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingVertical: 2 },
  tab: { minWidth: 124, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.m, borderWidth: 1.5, borderColor: colors.line, borderTopWidth: 4, backgroundColor: colors.surface, gap: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  type: { fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 1 },
  live: { fontFamily: fonts.bold, fontSize: 10, color: colors.good, backgroundColor: colors.goodLight, borderRadius: radius.pill, paddingHorizontal: 6, overflow: 'hidden' },
  label: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  struck: { textDecorationLine: 'line-through', color: colors.ink3 },
  faded: { opacity: 0.55 },
  ghost: { borderStyle: 'dashed', borderTopWidth: 1.5 },
  add: { borderStyle: 'dashed', borderTopWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brandLight },
});
