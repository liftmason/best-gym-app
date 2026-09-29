/**
 * The exercise library beside the board (the mockup's .lib-rail): search, tag filters, and
 * each exercise with this athlete's history (a small e1RM line, the last top set, the trend).
 * "+" adds it to the selected day; on the web it can also be dragged onto a day. Tapping the
 * history opens the athlete's log of it.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button, Card, colors, fonts, Segmented, Sheet, Text } from '@/ui';

import { ExerciseSheet } from '../library/exercises';

import { Draggable } from './dnd';
import { useRail, useTags, type RailExercise } from './queries';

function Mini({ values, down }: { values: number[]; down: boolean }) {
  if (values.length < 2) return <View style={{ width: 52 }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * 50 + 1;
  const y = (v: number) => (hi === lo ? 9 : 17 - ((v - lo) / (hi - lo)) * 16);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <Svg width={52} height={18}>
      <Path d={d} fill="none" stroke={down ? colors.bad : colors.good} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const TREND: Record<string, string> = { up: '▲', down: '▼', flat: '—' };

type Props = { athleteId: string; first: string; dayLabel: string | null; readOnly: boolean; onAdd: (exercise: RailExercise) => void };

export function Rail({ athleteId, first, dayLabel, readOnly, onAdd }: Props) {
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<'recent' | 'az'>('recent');
  const [log, setLog] = useState<RailExercise | null>(null);
  const [creating, setCreating] = useState(false);
  const rail = useRail(athleteId, q.trim(), tags, sort);
  const allTags = useTags();
  const items = rail.data ?? [];

  return (
    <Card style={styles.rail} padded={false}>
      <View style={styles.head}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="h4">Exercise library</Text>
          {!readOnly ? <Button size="sm" variant="ghost" title="+ New" onPress={() => setCreating(true)} /> : null}
        </View>
        <View style={styles.search}>
          <Feather name="search" size={14} color={colors.ink4} />
          <TextInput accessibilityLabel="Search exercises" value={q} onChangeText={setQ} placeholder="Search exercises…" placeholderTextColor={colors.ink4} style={styles.searchInput} />
        </View>
        <View style={styles.chips}>
          {(allTags.data ?? []).map((t) => {
            const on = tags.includes(t.id);
            return (
              <Pressable key={t.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Tag ${t.name}`} onPress={() => setTags(on ? tags.filter((x) => x !== t.id) : [...tags, t.id])} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && { color: colors.brand }]}>{t.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ScrollView style={styles.list} nestedScrollEnabled>
        {items.map((e) => (
          <Draggable key={e.id} id={`rail-${e.id}`} data={{ kind: 'exercise', exercise: { id: e.id, name: e.name } }} disabled={readOnly}>
            <View style={styles.item}>
              <View style={styles.itemTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cat}>{e.category}</Text>
                  <Text style={styles.name}>{e.name}</Text>
                </View>
                {!readOnly ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Add ${e.name} to ${dayLabel ?? 'the selected day'}`} onPress={() => onAdd(e)} style={styles.plus}>
                    <Feather name="plus" size={16} color={colors.brand} />
                  </Pressable>
                ) : null}
              </View>
              {e.tags.length ? (
                <Text variant="tiny" tone="muted" numberOfLines={1}>
                  {e.tags.slice(0, 3).join(' · ')}
                  {e.tags.length > 3 ? ` +${e.tags.length - 3}` : ''}
                </Text>
              ) : null}
              {e.history ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${first}'s log of ${e.name}: ${e.history.line}`} onPress={() => setLog(e)} style={styles.hist}>
                  <Mini values={e.history.series} down={e.history.trend === 'down'} />
                  <Text variant="tiny" tone="ink2" style={{ flex: 1 }} numberOfLines={1}>
                    {e.history.line}
                  </Text>
                  <Text style={[styles.trend, { color: e.history.trend === 'down' ? colors.bad : e.history.trend === 'up' ? colors.good : colors.ink4 }]}>{TREND[e.history.trend ?? 'flat'] ?? '—'}</Text>
                </Pressable>
              ) : (
                <Text variant="tiny" tone="faint">
                  Not logged by {first} yet
                </Text>
              )}
            </View>
          </Draggable>
        ))}
        {rail.data && !items.length ? (
          <View style={{ padding: 16, gap: 6 }}>
            <Text variant="small" tone="muted">
              No exercises match.
            </Text>
            {tags.length || q ? (
              <Pressable accessibilityRole="button" onPress={() => (setTags([]), setQ(''))}>
                <Text variant="small" tone="brand" style={{ fontFamily: fonts.semibold }}>
                  Clear filters
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.foot}>
        <Text variant="tiny" tone="muted">
          {items.length} exercise{items.length === 1 ? '' : 's'}
        </Text>
        <Segmented
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'recent', label: 'Last done' },
            { value: 'az', label: 'A–Z' },
          ]}
        />
      </View>
      <ExerciseSheet exercise={creating ? 'new' : null} onClose={() => setCreating(false)} />
      <Sheet open={Boolean(log)} onClose={() => setLog(null)} title={log ? `${log.name} · ${first}'s log` : ''}>
        {log?.history?.log.map((entry, i) => (
          <View key={i} style={styles.logRow}>
            <Text variant="small" tone="muted" style={{ width: 110 }}>
              {entry.date}
            </Text>
            <Text variant="small" style={{ fontFamily: fonts.semibold }}>
              {entry.top}
            </Text>
          </View>
        ))}
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  rail: { overflow: 'hidden' },
  head: { padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10 },
  searchInput: { flex: 1, paddingVertical: 7, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  chipText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink3 },
  list: { maxHeight: 620 },
  item: { paddingVertical: 9, paddingHorizontal: 14, gap: 3, borderBottomWidth: 1, borderBottomColor: colors.line2, backgroundColor: colors.surface },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cat: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink4 },
  name: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  plus: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.brandLight, alignItems: 'center', justifyContent: 'center' },
  hist: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trend: { fontSize: 11, fontFamily: fonts.bold },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderTopWidth: 1, borderTopColor: colors.line },
  logRow: { flexDirection: 'row', gap: 12, paddingVertical: 4 },
});
