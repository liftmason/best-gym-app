/**
 * Applying a template or saved week with a preview (the old _apply_bar.html and
 * _ghost_board.html). The coach picks training days, how tag slots are filled, where it
 * starts and whether to publish; the API's preview (which writes nothing) lays the new weeks
 * out as dashed weeks to review, and only "Confirm apply" writes them.
 */
import { Feather } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, ok } from '@/api';
import { dayMonth, shortDay } from '@/training/format';
import { Button, Chip, colors, fonts, radius, Select, Text, weekTypeColours } from '@/ui';

import type { Choices, Preview } from './queries';

export type Source = { id: string; kind: string; name: string };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Weekday names from the gym's first day of the week (the API's days are offsets from it). */
export function dayNames(weekStart: number): string[] {
  return WEEKDAYS.map((_, i) => WEEKDAYS[(weekStart + i) % 7]);
}

export function usePreview(athleteId: string, choices: Choices | null) {
  return useQuery({
    // Not under the athlete's key: refreshing after a change mustn't ask for the preview again.
    queryKey: ['coach', 'apply-preview', athleteId, choices],
    queryFn: () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/apply/preview', { params: { path: { athlete_id: athleteId } }, body: choices! })),
    enabled: Boolean(choices),
    placeholderData: keepPreviousData,
  });
}

/** The apply bar's summary line, as the old one read. */
export function summaryLine(preview: Preview, first: string, current: string | null): string {
  const s = preview.summary;
  const weeks = preview.weeks;
  const per = preview.choices.days?.length ?? 0;
  const parts = [`${s.weeks} new week${s.weeks === 1 ? '' : 's'}${weeks.length ? ` (${weeks[0].label}${weeks.length > 1 ? `–${weeks[weeks.length - 1].label}` : ''})` : ''} at ${per}×/week`];
  parts.push(`${s.sessions} session${s.sessions === 1 ? '' : 's'}`);
  if (s.tag_slots) parts.push(`${s.tag_slots} tag slot${s.tag_slots === 1 ? '' : 's'} ${preview.choices.mode === 'recent' ? `resolved from ${first}'s history` : 'filled with defaults'}`);
  if (s.new_program) parts.push(current ? `starts a new program (“${current}” ends and is kept)` : 'starts a new program');
  if (s.replaced) parts.push(`replaces ${s.replaced} empty week${s.replaced === 1 ? '' : 's'}`);
  if (s.moved) parts.push(`${s.moved} scheduled week${s.moved === 1 ? '' : 's'} move${s.moved === 1 ? 's' : ''} after`);
  parts.push(preview.choices.publish ? 'published straight away' : 'arrives unpublished');
  if (s.habits) parts.push(`${s.habits} habit${s.habits === 1 ? '' : 's'} prescribed (unless ${first} already has them)`);
  return parts.join(' · ');
}

type BarProps = {
  choices: Choices;
  onChange: (choices: Choices) => void;
  preview: Preview | undefined;
  sources: Source[];
  first: string;
  current: string | null;
  weekStart: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ApplyBar({ choices, onChange, preview, sources, first, current, weekStart, busy, onCancel, onConfirm }: BarProps) {
  const days = choices.days ?? preview?.choices.days ?? [];
  const names = dayNames(weekStart);
  const set = (patch: Partial<Choices>) => onChange({ ...choices, ...patch });
  return (
    <View style={styles.bar} accessibilityLabel="Apply preview">
      <View style={styles.row}>
        <Chip tone="brand" label="Previewing" />
        <View style={{ minWidth: 220, flexShrink: 1 }}>
          <Select
            compact
            label="Template or saved week"
            value={choices.template_id}
            onChange={(template_id) => onChange({ template_id, days: null, mode: choices.mode, start: '', publish: choices.publish })}
            options={sources.map((s) => ({ value: s.id, label: s.name, hint: s.kind === 'week' ? 'Saved week' : 'Program template' }))}
          />
        </View>
        <Text variant="small" tone="muted">
          on
        </Text>
        <View style={styles.days}>
          {names.map((name, offset) => {
            const on = days.includes(offset);
            return (
              <Pressable
                key={name}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Train on ${name}`}
                onPress={() => set({ days: on ? days.filter((d) => d !== offset) : [...days, offset].sort((a, b) => a - b), start: '' })}
                style={[styles.day, on && styles.dayOn]}
              >
                <Text style={[styles.dayText, on && { color: colors.white }]}>{name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.row}>
        <Select
          compact
          label="Tag slots"
          value={choices.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'recent', label: `Tag slots: ${first}'s recent lifts` },
            { value: 'default', label: 'Tag slots: template defaults' },
          ]}
        />
        {preview ? (
          <View style={{ minWidth: 240, flexShrink: 1 }}>
            <Select compact label="Where it starts" value={preview.choices.start} onChange={(start) => set({ start })} options={preview.placements} />
          </View>
        ) : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: choices.publish }} onPress={() => set({ publish: !choices.publish })} style={styles.publish}>
          <View style={[styles.box, choices.publish && styles.boxOn]}>{choices.publish ? <Feather name="check" size={12} color={colors.white} /> : null}</View>
          <Text variant="small">Publish now</Text>
        </Pressable>
      </View>
      {!days.length ? (
        <Text variant="small" tone="bad">
          Pick at least one training day.
        </Text>
      ) : preview ? (
        <Text variant="small" tone="ink2">
          {summaryLine(preview, first, current)} — click the dashed weeks to review each one.
        </Text>
      ) : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" title="Cancel" onPress={onCancel} />
        <Button size="sm" variant="good" title="Confirm apply" busy={busy} disabled={!days.length || !preview?.weeks.length} onPress={onConfirm} />
      </View>
    </View>
  );
}

/** One of the new weeks, read-only, as it would land on the board. */
export function GhostWeek({ week, sourceName, weekStart }: { week: Preview['weeks'][number]; sourceName: string; weekStart: number }) {
  const tone = weekTypeColours(week.week_type?.colour ?? colors.ink4);
  const names = dayNames(weekStart);
  return (
    <View style={{ gap: 10 }}>
      <Text variant="h4">
        {week.label} · {dayMonth(week.start)} — preview of “{sourceName}”
      </Text>
      <View style={styles.ghostDays}>
        {names.map((name, offset) => {
          const day = week.days.find((d) => d.offset === offset);
          return (
            <View key={name} style={[styles.ghostDay, { borderColor: tone.colour }]}>
              <Text style={styles.ghostHead}>
                {day ? shortDay(day.date) : name}
                {day ? '' : ' · rest'}
              </Text>
              {day ? (
                <>
                  <Text variant="tiny" tone="muted" style={{ fontFamily: fonts.semibold }}>
                    {day.session}
                  </Text>
                  {day.exercises.map((e, i) => (
                    <View key={i} style={[styles.ghostItem, { borderLeftColor: tone.colour }]}>
                      <Text style={styles.ghostName}>{e.exercise}</Text>
                      <Text variant="tiny" tone="muted">
                        {e.summary}
                        {e.tag_slot ? ' · tag slot' : ''}
                      </Text>
                    </View>
                  ))}
                </>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text variant="tiny" tone="muted">
        Nothing is written until you confirm. After applying, every exercise here is editable like any other.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 10, padding: 14, borderRadius: radius.l, borderWidth: 1.5, borderColor: colors.brand, backgroundColor: colors.brandLight },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  day: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  dayOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  dayText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  publish: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: colors.ink4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  ghostDays: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ghostDay: { flexGrow: 1, flexBasis: 120, minHeight: 120, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.m, padding: 8, gap: 5, backgroundColor: colors.surface },
  ghostHead: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink2, textTransform: 'uppercase' },
  ghostItem: { borderLeftWidth: 3, paddingLeft: 6 },
  ghostName: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
});
