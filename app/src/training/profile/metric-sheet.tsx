/** Editing one training metric (metrics.update, offline), in the athlete's unit. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { YEARS, type Current } from '@/domain/metrics';
import { norm, fromKg, type Unit } from '@/domain/units';
import { metricsUpdate, Refused } from '@/sync/actions';
import type { SyncEngine } from '@/sync/engine';
import { Button, colors, Field, fonts, radius, Sheet, space, Text } from '@/ui';

export function shown(metric: Current, unit: Unit): string {
  if (metric.value === null) return '';
  if (metric.kind === 'weight') return `${norm(fromKg(metric.value, unit))} ${unit}`;
  if (metric.kind === 'height') return `${norm(metric.value)} cm`;
  return metric.value;
}

export function MetricSheet({
  metric,
  unit,
  engine,
  onClose,
}: {
  metric: Current | null;
  unit: Unit;
  engine: SyncEngine;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!metric) return null;

  async function save(raw: string) {
    setProblem(null);
    try {
      await engine.enqueue(metricsUpdate, { values: { [metric!.key]: raw } });
      setValue('');
      onClose();
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't save that. Try again.");
    }
  }

  const label = metric.kind === 'weight' ? `${metric.label} (${unit})` : metric.kind === 'height' ? `${metric.label} (cm)` : metric.label;
  return (
    <Sheet
      open
      onClose={onClose}
      title={metric.label}
      footer={metric.kind === 'years' ? undefined : <Button title="Save" block disabled={!value.trim()} onPress={() => save(value)} />}
    >
      {metric.kind === 'years' ? (
        <View style={styles.choices}>
          {YEARS.map(([v, text]) => (
            <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: metric.value === text }} onPress={() => save(v)} style={[styles.choice, metric.value === text && styles.on]}>
              <Text style={styles.choiceText}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Field label={label} value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={shown(metric, unit)} error={problem} autoFocus />
      )}
      {metric.kind === 'years' && problem ? (
        <Text variant="small" tone="bad">
          {problem}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  choice: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingVertical: 12, paddingHorizontal: 16 },
  on: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  choiceText: { fontFamily: fonts.bold },
});
