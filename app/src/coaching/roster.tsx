/** "Your athletes" (the mockup's roster table and athlete cards), sorted and filtered by the server. */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { components } from '@/api';
import { dayMonth } from '@/training/format';
import { Avatar, Card, colors, fonts, radius, space, Text, WeekPill } from '@/ui';

import { Loading } from './layout';
import { useRoster } from './queries';

type Row = components['schemas']['RosterRow'];

export const SORTS: [string, string][] = [
  ['attention', 'Needs attention first'],
  ['name', 'Name A–Z'],
  ['compliance', 'Compliance low→high'],
  ['competition', 'Next competition'],
];

const BAND: Record<string, string> = { good: colors.good, ok: colors.warn, low: colors.bad };

function Compliance({ value, band }: { value: number | null; band: string }) {
  if (value === null) return <Text variant="tiny" tone="muted">—</Text>;
  return (
    <View style={[styles.ring, { borderColor: BAND[band] ?? colors.ink4 }]} accessibilityLabel={`${value}% compliance`}>
      <Text style={styles.ringText}>{value}%</Text>
    </View>
  );
}

function RosterRowView({ row }: { row: Row }) {
  const who = [row.weight_class, row.competition_name ? `${row.competition_name}${row.competition_date ? `, ${dayMonth(row.competition_date)}` : ''}` : 'no comp scheduled']
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${row.athlete.name}${row.alerts ? `, ${row.alerts} to look at` : ''}`}
      onPress={() => router.push({ pathname: '/athletes/[id]', params: { id: row.athlete.id } })}
      style={styles.row}
    >
      <Avatar name={row.athlete.name} size={36} />
      <View style={styles.main}>
        <Text variant="small" style={styles.bold} numberOfLines={1}>
          {row.athlete.name}
        </Text>
        <Text variant="tiny" tone="muted" numberOfLines={1}>
          {who}
        </Text>
        <View style={styles.meta}>
          {row.week?.week_type ? (
            <WeekPill name={`${row.week.week_type.name} · ${row.week.label.toLowerCase()}`} colour={row.week.week_type.colour} />
          ) : (
            <Text variant="tiny" tone="muted">
              no program this week
            </Text>
          )}
          <Text variant="tiny" tone="muted" numberOfLines={1}>
            {row.last ? `${dayMonth(row.last.date)}${row.readiness ? ` · readiness ${row.readiness}/10` : ''}` : 'no sessions yet'}
          </Text>
        </View>
        {row.top_alert ? (
          <View style={styles.alert}>
            <Feather name="alert-circle" size={12} color={colors.bad} />
            <Text variant="tiny" tone="bad" numberOfLines={1} style={{ flex: 1 }}>
              {row.top_alert}
              {row.alerts > 1 ? ` · +${row.alerts - 1} more` : ''}
            </Text>
          </View>
        ) : null}
      </View>
      <Compliance value={row.compliance} band={row.band} />
    </Pressable>
  );
}

export function Roster({ title = true }: { title?: boolean }) {
  const [sort, setSort] = useState('attention');
  const [q, setQ] = useState('');
  const roster = useRoster(sort, q.trim());
  return (
    <Card style={{ gap: space.s }} padded>
      {title ? <Text variant="h4">Your athletes</Text> : null}
      <TextInput
        accessibilityLabel="Filter athletes"
        placeholder="Filter by name or email…"
        placeholderTextColor={colors.ink4}
        value={q}
        onChangeText={setQ}
        style={styles.filter}
      />
      <View style={styles.sorts}>
        {SORTS.map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: sort === value }}
            onPress={() => setSort(value)}
            style={[styles.sort, sort === value && styles.sortOn]}
          >
            <Text variant="tiny" style={[styles.bold, sort === value && { color: colors.brand }]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {roster.data ? (
        roster.data.length ? (
          roster.data.map((row) => <RosterRowView key={row.athlete.id} row={row} />)
        ) : (
          <Text variant="small" tone="muted">
            {q.trim() ? 'No athlete matches that.' : 'No athletes yet. Invite your first one.'}
          </Text>
        )
      ) : (
        <Loading error={roster.error} retry={() => roster.refetch()} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: 1, borderTopColor: colors.line2 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bold: { fontFamily: fonts.bold },
  ring: { width: 46, height: 46, borderRadius: 23, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 11, fontFamily: fonts.bold },
  filter: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingHorizontal: 12, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 14, color: colors.ink },
  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sort: { borderWidth: 1, borderColor: colors.line, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  sortOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
});
