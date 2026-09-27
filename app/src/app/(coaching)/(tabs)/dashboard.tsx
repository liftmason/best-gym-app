import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useMe } from '@/auth/me';
import { AttentionFeed } from '@/coaching/feed';
import { CoachScreen, Loading, WIDE } from '@/coaching/layout';
import { useDashboard } from '@/coaching/queries';
import { Roster } from '@/coaching/roster';
import { RpePill } from '@/coaching/rpe';
import { dayMonth } from '@/training/format';
import { Avatar, Button, Card, Chip, colors, fonts, space, Text } from '@/ui';

function greeting(timezone: string): string {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  } catch {
    // an unknown zone: the device's
  }
  return hour < 12 ? 'Good morning' : 'Good afternoon';
}

function longDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  } catch {
    return '';
  }
}

function Kpi({ value, label, change, warn }: { value: string; label: string; change?: { text: string; up: boolean } | null; warn?: boolean }) {
  return (
    <Card style={styles.kpi}>
      <Text style={[styles.kpiValue, warn && { color: colors.warn }]}>{value}</Text>
      <Text variant="tiny" tone="muted">
        {label}
      </Text>
      {change ? (
        <Text variant="tiny" style={{ color: change.up ? colors.good : colors.bad, fontFamily: fonts.semibold }}>
          {change.up ? '▲' : '▼'} {change.text}
        </Text>
      ) : null}
    </Card>
  );
}

/** The coach's dashboard (the mockup's #panel-dashboard): the numbers, the attention feed, today and recent sessions. */
export default function Today() {
  const me = useMe();
  const dashboard = useDashboard();
  const wide = useWindowDimensions().width >= WIDE;
  const gym = me.data?.coach?.gym;
  const first = me.data?.name.split(/\s+/)[0] ?? '';
  const tz = gym?.timezone ?? 'UTC';

  const invite = <Button title="+ Invite athlete" size="sm" onPress={() => router.push({ pathname: '/athletes', params: { invite: '1' } })} />;
  if (!dashboard.data) {
    return (
      <CoachScreen title={`${greeting(tz)}, ${first}`} subtitle={longDate(tz)} actions={invite}>
        <Loading error={dashboard.error} retry={() => dashboard.refetch()} />
      </CoachScreen>
    );
  }
  const { kpis, today, recent } = dashboard.data;
  const side = (
    <View style={styles.column}>
      <AttentionFeed />
      <Card style={{ gap: space.s }}>
        <Text variant="h4">Sessions today</Text>
        {today.length ? (
          today.map((t) => (
            <Pressable
              key={t.athlete.id}
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/athletes/[id]', params: { id: t.athlete.id, tab: 'program' } })}
              style={styles.line}
            >
              <Avatar name={t.athlete.name} size={26} />
              <Text variant="small" style={{ flex: 1 }} numberOfLines={1}>
                {t.athlete.name}
              </Text>
              {!t.count ? (
                <Text variant="tiny" tone="muted">
                  rest day
                </Text>
              ) : t.done ? (
                <Chip tone="good" label="✓ completed" />
              ) : (
                <Chip tone="brand" label={`${t.count} exercise${t.count === 1 ? '' : 's'}`} />
              )}
            </Pressable>
          ))
        ) : (
          <Text variant="small" tone="muted">
            No athletes yet — invite your first one.
          </Text>
        )}
      </Card>
      <Card style={{ gap: space.s }}>
        <View style={styles.spread}>
          <Text variant="h4">Recent sessions</Text>
          <Text variant="tiny" tone="muted">
            last 7 days · all athletes
          </Text>
        </View>
        {recent.length ? (
          recent.map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/athletes/[id]', params: { id: s.athlete.id, tab: 'sessions', focus: `session-${s.id}` } })}
              style={styles.line}
            >
              <Avatar name={s.athlete.name} size={26} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="tiny" numberOfLines={1}>
                  <Text variant="tiny" style={{ fontFamily: fonts.bold }}>
                    {s.athlete.name}
                  </Text>{' '}
                  · {dayMonth(s.date)}
                </Text>
                <Text variant="tiny" tone="muted" numberOfLines={1}>
                  {s.name}
                </Text>
              </View>
              {s.issues ? <Feather name="alert-triangle" size={14} color={colors.bad} accessibilityLabel="Issue reported" /> : null}
              <RpePill rpe={s.rpe} />
            </Pressable>
          ))
        ) : (
          <Text variant="small" tone="muted">
            No sessions in the last 7 days.
          </Text>
        )}
      </Card>
    </View>
  );

  return (
    <CoachScreen
      title={`${greeting(tz)}, ${first}`}
      subtitle={[longDate(tz), gym?.name].filter(Boolean).join(' · ')}
      actions={invite}
      refreshing={dashboard.isRefetching}
      onRefresh={() => dashboard.refetch()}
    >
      <View style={[styles.kpis, wide && styles.kpisWide]}>
        <Kpi value={String(kpis.active)} label="Active athletes" change={kpis.joined ? { text: `${kpis.joined} this month`, up: true } : null} />
        <Kpi
          value={kpis.compliance !== null ? `${kpis.compliance}%` : '—'}
          label="7-day compliance"
          change={kpis.compliance_change ? { text: `${kpis.compliance_change} pts`, up: kpis.compliance_dir === 'up' } : null}
        />
        <Kpi
          value={String(kpis.sessions)}
          label="Sessions completed this week"
          change={kpis.sessions_change ? { text: `${kpis.sessions_change} vs last week`, up: kpis.sessions_dir === 'up' } : null}
        />
        <Kpi
          value={String(kpis.need_programming)}
          label="Need programming"
          warn={kpis.need_programming > 0}
          change={kpis.need_programming ? { text: 'runs out < 7 days', up: false } : null}
        />
      </View>
      {wide ? (
        <View style={styles.grid}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Roster />
          </View>
          <View style={{ width: 340 }}>{side}</View>
        </View>
      ) : (
        side
      )}
    </CoachScreen>
  );
}

const styles = StyleSheet.create({
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  kpisWide: { flexWrap: 'nowrap' },
  kpi: { flexGrow: 1, flexBasis: '45%', gap: 2 },
  kpiValue: { fontFamily: fonts.extrabold, fontSize: 26 },
  column: { gap: space.m },
  grid: { flexDirection: 'row', gap: space.m, alignItems: 'flex-start' },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 4 },
});
