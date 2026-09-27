import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { prescribed } from '@/domain/sessions';
import type { SessionExerciseRow, World } from '@/domain/world';
import { colors, fonts, radius, space, Text } from '@/ui';

/** The warm-up checklist: each drill's name (linking to the coach's demo), its dose, and a tick. */
export function Warmups({
  world,
  items,
  coach,
  editable,
  onTick,
}: {
  world: World;
  items: SessionExerciseRow[];
  coach: string;
  editable: boolean;
  onTick: (se: SessionExerciseRow, checked: boolean) => void;
}) {
  return (
    <>
      <Text variant="tiny" tone="muted" style={styles.count}>
        {items.length} drill{items.length === 1 ? '' : 's'} · tap a name for {coach}&apos;s demo
      </Text>
      <Text variant="h3">Warm-up</Text>
      <View style={styles.list}>
        {items.map((se) => {
          const p = prescribed(se);
          const url = se.exercise_id ? world.exercise.get(se.exercise_id)?.youtube_url : undefined;
          const done = se.checked_at !== null;
          return (
            <View key={se.id} style={[styles.item, done && styles.done]}>
              <View style={styles.body}>
                {url ? (
                  <Pressable accessibilityRole="link" accessibilityHint="Opens the demo in YouTube" onPress={() => Linking.openURL(url)}>
                    <Text style={[styles.name, styles.link]}>{se.exercise_name} ↗</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.name}>{se.exercise_name}</Text>
                )}
                {p?.rep_scheme ? <Text variant="tiny">{p.rep_scheme}</Text> : null}
                {p?.note ? (
                  <Text variant="tiny" tone="muted">
                    {p.note}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done, disabled: !editable }}
                accessibilityLabel={`Done: ${se.exercise_name}`}
                disabled={!editable}
                onPress={() => onTick(se, !done)}
                style={[styles.tick, done && styles.tickOn]}
                hitSlop={8}
              >
                <Text style={{ color: done ? colors.white : colors.ink4, fontFamily: fonts.bold }}>✓</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  count: { textTransform: 'uppercase', fontFamily: fonts.bold },
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.m,
    padding: space.m,
  },
  done: { borderColor: colors.good, backgroundColor: colors.goodLight },
  body: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bold, fontSize: 14 },
  link: { color: colors.brand },
  tick: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.good, borderColor: colors.good },
});
