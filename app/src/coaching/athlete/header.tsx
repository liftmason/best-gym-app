/** An athlete's header (the mockup's #cdHead): who, this week, class, streak, the tracked lifts' maxes, compliance. */
import { StyleSheet, View } from 'react-native';

import type { components } from '@/api';
import { Avatar, Card, Chip, colors, fonts, space, Text, WeekPill } from '@/ui';

type Athlete = components['schemas']['AthleteOut'];

const BAND: Record<string, string> = { good: colors.good, ok: colors.warn, low: colors.bad };

export function AthleteHeader({ athlete }: { athlete: Athlete }) {
  const lifts = athlete.metrics.filter((m) => m.key.startsWith('lift_'));
  return (
    <Card style={styles.card}>
      <View style={styles.who}>
        <Avatar name={athlete.athlete.name} size={52} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text variant="h3" numberOfLines={1}>
            {athlete.athlete.name}
          </Text>
          <View style={styles.pills}>
            {athlete.week?.week_type ? (
              <WeekPill name={`${athlete.week.week_type.name} · ${athlete.week.label.toLowerCase()}`} colour={athlete.week.week_type.colour} />
            ) : null}
            {athlete.weight_class ? <Chip label={`${athlete.weight_class} class`} /> : null}
            <Chip tone={athlete.streak ? 'good' : 'plain'} label={`${athlete.streak}-session streak`} />
          </View>
        </View>
      </View>
      <View style={styles.stats}>
        {lifts.map((m) => (
          <View key={m.key} style={styles.stat}>
            <Text style={styles.value}>{m.value ?? '—'}</Text>
            <Text variant="tiny" tone="muted" numberOfLines={1}>
              {m.label.replace(/ 1RM$/, '')}
            </Text>
          </View>
        ))}
        <View style={styles.stat}>
          <Text style={[styles.value, { color: BAND[athlete.band] ?? colors.ink }]}>{athlete.compliance !== null ? `${athlete.compliance}%` : '—'}</Text>
          <Text variant="tiny" tone="muted">
            Compliance
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.m },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  stat: { flexGrow: 1, flexBasis: 70, backgroundColor: colors.surface2, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  value: { fontFamily: fonts.extrabold, fontSize: 16 },
});
