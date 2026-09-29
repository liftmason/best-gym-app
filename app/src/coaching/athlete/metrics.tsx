/** An athlete's Metrics tab (the mockup's #tab-metrics, and the old "Session PRs" card). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, ApiError, ok, type components } from '@/api';
import { heightFromFeet, showHeight } from '@/domain/height';
import { InvalidMetric, YEARS } from '@/domain/metrics';
import type { Unit } from '@/domain/units';
import { dayMonth } from '@/training/format';
import { Button, Card, Chip, colors, Field, fonts, HeightField, radius, Sheet, space, Text } from '@/ui';

import { Loading } from '../layout';
import { QuestionsEditor } from '../library/questions';
import { keys } from '../queries';

type Metric = components['schemas']['MetricOut'];

const failed = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't do that. Try again.");

function MetricSheet({ id, metric, unit, first, onClose, onSaved }: { id: string; metric: Metric | null; unit: string; first: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!metric) return null;
  // A gym using pounds gives height in feet and inches; it's stored in centimetres.
  const imperial = metric.kind === 'height' && unit === 'lb';
  function saveFeet() {
    try {
      const cm = heightFromFeet(feet, inches);
      if (cm) save(cm);
    } catch (error) {
      setProblem(error instanceof InvalidMetric ? error.message : "Couldn't save that. Try again.");
    }
  }
  async function save(raw: string) {
    setProblem(null);
    try {
      await ok(api.client.PUT('/api/v1/athletes/{athlete_id}/metrics/{key}', { params: { path: { athlete_id: id, key: metric!.key } }, body: { value: raw } }));
      setValue('');
      onSaved();
      onClose();
    } catch (error) {
      setProblem(error instanceof ApiError ? (Object.values(error.fields)[0] ?? error.message) : failed(error));
    }
  }
  const label = metric.kind === 'weight' ? `${metric.label} (${unit})` : metric.kind === 'height' ? `${metric.label} (cm)` : metric.label;
  return (
    <Sheet open onClose={onClose} title={`Update ${metric.label.toLowerCase()}`} footer={
        metric.kind === 'years' ? undefined : imperial ? (
          <Button title="Save" block disabled={!feet.trim() && !inches.trim()} onPress={saveFeet} />
        ) : (
          <Button title="Save" block disabled={!value.trim()} onPress={() => save(value)} />
        )
      }>
      <View style={{ gap: space.m }}>
        {metric.kind === 'years' ? (
          <View style={styles.choices}>
            {YEARS.map(([v, text]) => (
              <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: metric.value === text }} onPress={() => save(v)} style={[styles.choice, metric.value === text && styles.on]}>
                <Text style={styles.bold}>{text}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          imperial ? (
            <HeightField feet={feet} inches={inches} onFeet={setFeet} onInches={setInches} error={problem} autoFocus />
          ) : (
            <Field label={label} value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={metric.value ?? ''} error={problem} autoFocus />
          )
        )}
        <Text variant="tiny" tone="muted">
          Logged as coach-entered. {first} sees the update.
        </Text>
        {metric.kind === 'years' && problem ? (
          <Text variant="small" tone="bad">
            {problem}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

export function Metrics({ id, first, unit, maxUpdates, focus }: { id: string; first: string; unit: string; maxUpdates: string; focus?: string }) {
  const queryClient = useQueryClient();
  const metrics = useQuery({
    queryKey: [...keys.athlete(id), 'metrics'],
    queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/metrics', { params: { path: { athlete_id: id } } })),
  });
  const prs = useQuery({
    queryKey: [...keys.athlete(id), 'prs'],
    queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/prs', { params: { path: { athlete_id: id } } })),
  });
  const [editing, setEditing] = useState<Metric | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.athlete(id) }), queryClient.invalidateQueries({ queryKey: ['coach', 'feed'] })]);

  async function act(call: () => Promise<unknown>, done?: string) {
    setSaid(null);
    try {
      await call();
      await refresh();
      if (done) setSaid(done);
    } catch (error) {
      setSaid(failed(error));
    }
  }

  if (!metrics.data) return <Loading error={metrics.error} retry={() => metrics.refetch()} />;
  const missing = metrics.data.metrics.filter((m) => m.value === null);
  return (
    <View style={{ gap: space.m }}>
      <Card style={[{ gap: space.s }, focus === 'prs' && styles.focus]}>
        <Text variant="h4">Session PRs</Text>
        <Text variant="tiny" tone="muted">
          When a session beats a max
        </Text>
        <View style={styles.choices}>
          {(
            [
              ['auto', 'Update the max automatically'],
              ['approve', 'I approve it first'],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: maxUpdates === value }}
              onPress={() => maxUpdates !== value && act(() => ok(api.client.PUT('/api/v1/athletes/{athlete_id}/max-updates', { params: { path: { athlete_id: id } }, body: { value } })))}
              style={[styles.choice, maxUpdates === value && styles.on]}
            >
              <Text variant="tiny" style={styles.bold}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {prs.data?.length ? (
          prs.data.map((pr) => (
            <View key={pr.set_id} style={styles.pr}>
              <Text variant="small">
                <Text variant="small" style={styles.bold}>
                  {pr.exercise}
                </Text>{' '}
                {pr.lift}{' '}
                <Text variant="tiny" tone="muted">
                  on {dayMonth(pr.date)} · working max {pr.current_max}
                </Text>
              </Text>
              <View style={styles.buttons}>
                <Button
                  title="Use as working max"
                  size="sm"
                  onPress={() => act(() => ok(api.client.POST('/api/v1/athletes/{athlete_id}/prs/{set_id}', { params: { path: { athlete_id: id, set_id: pr.set_id } }, body: { use: true } })))}
                />
                <Button
                  title="Keep current max"
                  size="sm"
                  variant="ghost"
                  onPress={() => act(() => ok(api.client.POST('/api/v1/athletes/{athlete_id}/prs/{set_id}', { params: { path: { athlete_id: id, set_id: pr.set_id } }, body: { use: false } })))}
                />
              </View>
            </View>
          ))
        ) : (
          <Text variant="tiny" tone="muted">
            Nothing waiting: new bests show here for you to decide.
          </Text>
        )}
      </Card>
      <Card style={[{ gap: space.s }, focus === 'metrics' && styles.focus]}>
        <View style={styles.spread}>
          <Text variant="h4">Training metrics</Text>
          {missing.length ? <Button title="Remind athlete" size="sm" variant="ghost" onPress={() => act(() => ok(api.client.POST('/api/v1/athletes/{athlete_id}/remind-metrics', { params: { path: { athlete_id: id } } })), `Reminder sent to ${first}`)} /> : null}
        </View>
        <Text variant="tiny" tone="muted">
          Fields {first} skipped show as not provided. You can fill them in yourself.
        </Text>
        <View style={styles.grid}>
          {metrics.data.metrics.map((m) => (
            <Pressable
              key={m.key}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${m.label}`}
              onPress={() => setEditing(m)}
              style={[styles.metric, m.value === null && styles.missing]}
            >
              <Text variant="tiny" tone="muted">
                {m.label}
              </Text>
              {m.value === null ? (
                <Chip tone="warn" label="not provided" />
              ) : (
                <>
                  <Text style={styles.value}>{m.kind === 'height' ? showHeight(m.value, unit as Unit) : m.value}</Text>
                  <Text variant="tiny" tone="faint">
                    {[m.source, m.date && dayMonth(m.date)].filter(Boolean).join(' · ')}
                  </Text>
                </>
              )}
            </Pressable>
          ))}
        </View>
        {said ? <Text variant="small" tone="muted">{said}</Text> : null}
      </Card>
      {metrics.data.history.length ? (
        <Card style={{ gap: 6 }}>
          <Text variant="h4">History</Text>
          {metrics.data.history.map((h, i) => (
            <View key={i} style={styles.spread}>
              <Text variant="tiny">
                {h.what} <Text variant="tiny" style={styles.bold}>{h.value}</Text>
              </Text>
              <Text variant="tiny" tone="muted">
                {dayMonth(h.date)} · {h.source}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      <MetricSheet id={id} metric={editing} unit={unit} first={first} onClose={() => setEditing(null)} onSaved={refresh} />
      <QuestionsEditor athlete={id} first={first} />
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  bold: { fontFamily: fonts.bold },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  choice: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingVertical: 8, paddingHorizontal: 12 },
  on: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  pr: { gap: 6, paddingTop: space.s, borderTopWidth: 1, borderTopColor: colors.line2 },
  buttons: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  metric: { flexGrow: 1, flexBasis: 140, gap: 2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.m, padding: space.m },
  missing: { borderStyle: 'dashed', borderColor: colors.warn },
  value: { fontFamily: fonts.extrabold, fontSize: 17 },
  focus: { borderColor: colors.brand, borderWidth: 2 },
});
