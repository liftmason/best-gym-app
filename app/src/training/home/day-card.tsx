/** A planned session on the selected day (the mockup's .today-card), and a rest day. */
import { StyleSheet, View } from 'react-native';

import type { Card } from '@/domain/week';
import type { WeekTypeRow } from '@/domain/world';
import { Button, colors, radius, space, Text, WeekPill, weekTypeColours } from '@/ui';

import { longDay, shortDay } from '../format';

function Tinted({ weekType, children }: { weekType?: WeekTypeRow; children: React.ReactNode }) {
  const light = weekType ? weekTypeColours(weekType.colour).light : colors.surface2;
  return <View style={[styles.card, { backgroundColor: light }]}>{children}</View>;
}

export function DayCard({
  card,
  date,
  isToday,
  weekType,
  onOpen,
  onReview,
}: {
  card: Card;
  date: string;
  isToday: boolean;
  weekType?: WeekTypeRow;
  onOpen: () => void;
  onReview: () => void;
}) {
  const pill = `${isToday ? "Today's session" : `${shortDay(date)}'s session`}${card.session.name ? ` · ${card.session.name}` : ''}`;
  return (
    <Tinted weekType={weekType}>
      <WeekPill name={pill} colour={weekType?.colour ?? colors.brand} />
      <Text variant="h3" style={styles.title}>
        {card.state === 'done' ? 'Completed ✓' : `${card.count} exercise${card.count === 1 ? '' : 's'}`}
      </Text>
      {weekType ? (
        <Text variant="small" tone="muted">
          {weekType.name} week{weekType.description ? ` · ${weekType.description}` : ''}
        </Text>
      ) : null}
      <View style={styles.items}>
        {card.items.map((item, i) => (
          <View key={i} style={styles.item}>
            <Text variant="small" style={styles.name}>
              {item.name}
            </Text>
            <Text variant="small" tone="muted" style={styles.dose}>
              {item.dose}
            </Text>
          </View>
        ))}
      </View>
      {card.state === 'done' ? (
        <Button title={card.editable ? 'Review or edit what you logged' : 'Review what you logged'} variant="soft" block onPress={onReview} />
      ) : card.state === 'paused' ? (
        <Button title="Resume session →" size="lg" block onPress={onOpen} />
      ) : card.state === 'start' ? (
        <Button title="Start session →" size="lg" block onPress={onOpen} />
      ) : card.state === 'backfill' ? (
        <>
          <Button title="Log this session" variant="ghost" block onPress={onOpen} />
          <Text variant="tiny" tone="muted" style={styles.centred}>
            Did it but didn&apos;t log it? Add what you did — it&apos;s saved to {longDay(date)}.
          </Text>
        </>
      ) : (
        <Text variant="tiny" tone="muted" style={styles.centred}>
          This session unlocks on {longDay(date)}.
        </Text>
      )}
    </Tinted>
  );
}

export function RestCard({ date, isToday, weekType }: { date: string; isToday: boolean; weekType?: WeekTypeRow }) {
  return (
    <Tinted weekType={weekType}>
      <Text variant="h3" style={styles.centred}>
        {isToday ? 'Today' : longDay(date)} — rest day
      </Text>
      <Text variant="small" tone="muted" style={styles.centred}>
        No training scheduled. Recovery is part of the program.
      </Text>
    </Tinted>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 4 },
  title: { marginTop: 6 },
  items: { gap: 6, marginTop: space.m, marginBottom: 14 },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  name: { flexShrink: 1 },
  dose: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  centred: { textAlign: 'center' },
});
