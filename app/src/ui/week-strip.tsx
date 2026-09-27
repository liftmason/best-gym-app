import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, fonts } from './theme';

export type StripDay = {
  date: string; // YYYY-MM-DD
  weekday: string; // "Mon"
  state: 'rest' | 'planned' | 'done' | 'missed';
  mark?: string; // a short line under the date, e.g. "2 ex" or "✓"
  today?: boolean;
};

/** The mockup's .week-strip: the training week, one box a day. */
export function WeekStrip({ days, onSelect }: { days: StripDay[]; onSelect?: (date: string) => void }) {
  return (
    <View style={styles.strip}>
      {days.map((d) => {
        const look = d.today ? styles.today : d.state === 'done' ? styles.done : d.state === 'missed' ? styles.missed : null;
        const light = d.today ? colors.white : undefined;
        return (
          <Pressable
            key={d.date}
            accessibilityRole="button"
            accessibilityLabel={`${d.weekday} ${d.date}, ${d.state}`}
            onPress={onSelect ? () => onSelect(d.date) : undefined}
            style={[styles.day, look, d.state === 'rest' && !d.today && styles.rest]}
          >
            <Text style={[styles.weekday, light ? { color: light } : null]}>{d.weekday}</Text>
            <Text style={[styles.date, light ? { color: light } : null]}>{Number(d.date.slice(8))}</Text>
            <Text style={[styles.mark, light ? { color: light } : null]}>{d.mark ?? ' '}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 5 },
  day: {
    flex: 1,
    borderRadius: 11,
    paddingTop: 8,
    paddingBottom: 7,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rest: { opacity: 0.45 },
  done: { borderColor: colors.good, backgroundColor: colors.goodLight },
  missed: { borderColor: colors.badLight, backgroundColor: colors.badLight },
  today: { borderColor: colors.brand, backgroundColor: colors.brand },
  weekday: { fontSize: 9.5, color: colors.ink4, textTransform: 'uppercase', fontFamily: fonts.bold },
  date: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.ink },
  mark: { fontSize: 9.5, marginTop: 1, color: colors.ink3, fontFamily: fonts.medium },
});
