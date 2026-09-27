import { StyleSheet, View } from 'react-native';

import type { LogRow } from '@/domain/world';
import { Button, Card, Text } from '@/ui';

import { dayMonth } from '../format';

/** A session started on another day and not finished. */
export function PausedCard({ log, onResume }: { log: LogRow; onResume: () => void }) {
  return (
    <Card style={styles.row}>
      <View style={styles.text}>
        <Text variant="h4">Paused session</Text>
        <Text variant="tiny" tone="muted" numberOfLines={1}>
          {dayMonth(log.date)} · {log.name}
        </Text>
      </View>
      <Button title="Resume →" size="sm" onPress={onResume} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, minWidth: 0 },
});
