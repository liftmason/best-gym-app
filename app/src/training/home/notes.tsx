import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ProgramRow, WeekRow } from '@/domain/world';
import { Card, space, Text } from '@/ui';

/** The coach's note on the whole program (folded), and their focus for the week. */
export function Notes({ program, week, coachName }: { program: ProgramRow | null; week: WeekRow | null; coachName: string | null }) {
  const [open, setOpen] = useState(false);
  const from = coachName ? `from ${coachName}` : '';
  return (
    <>
      {program?.note ? (
        <Card>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.spread}>
            <Text variant="h4">About {program.name}</Text>
            <Text variant="tiny" tone="muted">
              {from} {open ? '▴' : '▾'}
            </Text>
          </Pressable>
          {open ? (
            <Text variant="small" style={styles.body}>
              {program.note}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {week?.focus_note ? (
        <Card>
          <View style={styles.spread}>
            <Text variant="h4">Coach&apos;s focus this week</Text>
            <Text variant="tiny" tone="muted">
              {from}
            </Text>
          </View>
          <Text variant="small" style={styles.body}>
            {week.focus_note}
          </Text>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  body: { marginTop: space.s },
});
