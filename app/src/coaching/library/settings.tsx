/**
 * Settings (the old coach settings page): the gym and the coach's own choices, tracked lifts,
 * week types, and the plan when billing is turned on (decision F).
 */
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { ME, useMe } from '@/auth/me';
import { Button, Card, colors, Field, fonts, Segmented, Select, Text, useToast, weekTypeColours } from '@/ui';
import { confirm } from '@/ui/confirm';

import { useChange } from '../change';
import { libraryKeys, usePlans, useSettings, useTrackable, useTracked, useWeekTypes, type Settings as SettingsData } from './queries';

export function Settings() {
  const settings = useSettings();
  const me = useMe();
  const entitlements = me.data?.coach?.entitlements;
  return (
    <View style={{ gap: 14 }}>
      {settings.data ? <GymCard key={JSON.stringify(settings.data)} saved={settings.data} /> : null}
      <TrackedLifts />
      <WeekTypes />
      {entitlements?.billing_enabled ? <Plan owner={me.data?.coach?.role === 'owner'} /> : null}
    </View>
  );
}

function Check({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={styles.check}>
      <View style={[styles.box, on && styles.boxOn]}>{on ? <Feather name="check" size={12} color={colors.white} /> : null}</View>
      <Text variant="small" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function GymCard({ saved }: { saved: SettingsData }) {
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const set = (patch: Partial<SettingsData>) => setForm({ ...form, ...patch });

  async function save() {
    setBusy(true);
    try {
      await ok(api.client.PUT('/api/v1/settings', { body: { ...form, gym_name: form.gym_name.trim(), coach_title: form.coach_title.trim(), timezone: form.timezone.trim() } }));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['coach'] }), queryClient.invalidateQueries({ queryKey: ME })]);
      setErrors({});
      toast('Settings saved', 'good');
    } catch (error) {
      if (error instanceof ApiError) setErrors(Object.keys(error.fields).length ? error.fields : { '': error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Text variant="h3">Gym</Text>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Field label="Gym or team name" value={form.gym_name} onChangeText={(gym_name) => set({ gym_name })} maxLength={120} error={errors.gym_name} />
        </View>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Field label="Your title" value={form.coach_title} onChangeText={(coach_title) => set({ coach_title })} maxLength={60} error={errors.coach_title} />
        </View>
      </View>
      <Field label="Gym time zone" value={form.timezone} onChangeText={(timezone) => set({ timezone })} autoCapitalize="none" hint="The coach dashboard counts days in this zone, e.g. America/New_York." error={errors.timezone} />
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          Units
        </Text>
        <Segmented
          label="Units"
          value={form.units}
          onChange={(units) => set({ units })}
          options={[
            { value: 'kg', label: 'kilograms' },
            { value: 'lb', label: 'pounds' },
          ]}
        />
        <Text variant="tiny" tone="muted">
          New athletes start with this unit. Weights are stored exactly, so switching never loses precision.
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          Training weeks start on
        </Text>
        <Segmented
          label="Training weeks start on"
          value={String(form.week_start)}
          onChange={(v) => set({ week_start: Number(v) })}
          options={[
            { value: '0', label: 'Monday' },
            { value: '6', label: 'Sunday' },
          ]}
        />
        <Text variant="tiny" tone="muted">
          Used for new programs. Existing programs keep their dates.
        </Text>
      </View>
      <Check on={form.digest} label="Email me a morning digest — at 7am (gym time), only when something new needs your attention." onPress={() => set({ digest: !form.digest })} />
      {errors[''] ? (
        <Text variant="small" tone="bad">
          {errors['']}
        </Text>
      ) : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <Button title="Save settings" busy={busy} onPress={save} />
      </View>
    </Card>
  );
}

function TrackedLifts() {
  const tracked = useTracked();
  const trackable = useTrackable();
  const change = useChange();
  const [adding, setAdding] = useState<string | null>(null);
  const list = tracked.data ?? [];
  const refresh = [['coach', 'tracked'], ['coach', 'trackable'], ['coach', 'athlete'], libraryKeys.all];
  const available = (trackable.data ?? []).filter((e) => !list.some((t) => t.exercise.id === e.id));
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.row}>
        <Text variant="h3">Tracked lifts</Text>
        <Text variant="small" tone="muted">
          {list.length} of 6
        </Text>
      </View>
      <Text variant="small" tone="muted">
        The maxes you program percentages from. Athletes are asked for these when they join, and they appear on each athlete&apos;s Metrics tab and header, in this order. Bodyweight, height and years training are always included.
      </Text>
      {list.map((t, i) => (
        <View key={t.id} style={styles.line}>
          <Text style={{ fontFamily: fonts.semibold, flex: 1 }}>{t.exercise.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move ${t.exercise.name} up`} disabled={i === 0} onPress={() => change(() => ok(api.client.POST('/api/v1/tracked-lifts/{tracked_id}/move', { params: { path: { tracked_id: t.id } }, body: { direction: 'up' } })), { refresh })}>
            <Feather name="arrow-up" size={15} color={i === 0 ? colors.line : colors.ink3} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move ${t.exercise.name} down`} disabled={i === list.length - 1} onPress={() => change(() => ok(api.client.POST('/api/v1/tracked-lifts/{tracked_id}/move', { params: { path: { tracked_id: t.id } }, body: { direction: 'down' } })), { refresh })}>
            <Feather name="arrow-down" size={15} color={i === list.length - 1 ? colors.line : colors.ink3} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Stop tracking ${t.exercise.name}`}
            onPress={async () => {
              if (await confirm(`Stop tracking ${t.exercise.name}?`, "New athletes won't be asked for it and it leaves the Metrics tab. Maxes already recorded stay in each athlete's history.", 'Stop tracking'))
                change(() => ok(api.client.DELETE('/api/v1/tracked-lifts/{tracked_id}', { params: { path: { tracked_id: t.id } } })), { refresh, said: `Stopped tracking ${t.exercise.name}` });
            }}
          >
            <Feather name="trash-2" size={15} color={colors.ink4} />
          </Pressable>
        </View>
      ))}
      {list.length < 6 ? (
        <View style={styles.row}>
          <View style={{ minWidth: 220 }}>
            <Select label="Add a lift" value={adding} onChange={setAdding} options={available.map((e) => ({ value: e.id, label: e.name }))} placeholder="Add a lift…" />
          </View>
          <Button
            size="sm"
            title="Track"
            disabled={!adding}
            onPress={async () => {
              const name = available.find((e) => e.id === adding)?.name;
              if (await change(() => ok(api.client.POST('/api/v1/tracked-lifts', { body: { exercise_id: adding! } })), { refresh, said: `Now tracking ${name} — athletes are asked for it at onboarding` })) setAdding(null);
            }}
          />
        </View>
      ) : null}
      <Text variant="tiny" tone="muted">
        Only lifts measured in reps can be tracked. Archived exercises are never tracked.
      </Text>
    </Card>
  );
}

function WeekTypes() {
  const types = useWeekTypes();
  const change = useChange();
  const [name, setName] = useState('');
  const [colour, setColour] = useState('#2E9E5B');
  const refresh = [['coach', 'week-types'], ['coach', 'athlete'], libraryKeys.all];
  const active = (types.data ?? []).filter((t) => !t.archived);
  const archived = (types.data ?? []).filter((t) => t.archived);
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="h3">Week types</Text>
      <Text variant="small" tone="muted">
        Week types colour-code the program editor, the athlete&apos;s week strip, and every session card, so a training phase is recognisable at a glance. Edit a name, description or colour and it saves as you go.
      </Text>
      {active.map((t, i) => (
        <WeekTypeRow
          key={`${t.id}:${t.name}:${t.colour}:${t.description}`}
          type={t}
          first={i === 0}
          last={i === active.length - 1}
          onSave={(body) => change(() => ok(api.client.PUT('/api/v1/week-types/{week_type_id}', { params: { path: { week_type_id: t.id } }, body })), { refresh })}
          onMove={(direction) => change(() => ok(api.client.POST('/api/v1/week-types/{week_type_id}/move', { params: { path: { week_type_id: t.id } }, body: { direction } })), { refresh })}
          onRemove={async () => {
            const message = t.uses ? `“${t.name}” is used by ${t.uses} week${t.uses === 1 ? '' : 's'}, so it will be archived: it leaves the pickers and those weeks keep it.` : 'It isn’t used by any week.';
            if (await confirm(t.uses ? `Archive “${t.name}”?` : `Delete the week type “${t.name}”?`, message, t.uses ? 'Archive' : 'Delete'))
              change(() => ok(api.client.POST('/api/v1/week-types/{week_type_id}/remove', { params: { path: { week_type_id: t.id } } })), { refresh });
          }}
        />
      ))}
      {!active.length && types.data ? (
        <Text variant="small" tone="muted">
          No week types. Add one before building programs.
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput accessibilityLabel="New week type" value={name} onChangeText={setName} placeholder="New week type, e.g. Peaking" placeholderTextColor={colors.ink4} maxLength={40} style={[styles.input, { flex: 1, minWidth: 180 }]} />
        <TextInput accessibilityLabel="New week type colour" value={colour} onChangeText={setColour} autoCapitalize="characters" maxLength={7} style={[styles.input, { width: 96 }]} />
        <View style={[styles.swatch, { backgroundColor: /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : colors.surface3 }]} />
        <Button
          size="sm"
          title="Add"
          disabled={!name.trim()}
          onPress={async () => {
            if (await change(() => ok(api.client.POST('/api/v1/week-types', { body: { name: name.trim(), colour } })), { refresh })) setName('');
          }}
        />
      </View>
      {archived.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="label" tone="ink2">
            Archived — kept on the weeks that use them:
          </Text>
          {archived.map((t) => (
            <View key={t.id} style={styles.line}>
              <View style={[styles.swatch, { backgroundColor: t.colour }]} />
              <Text variant="small" style={{ flex: 1 }}>
                {t.name}
              </Text>
              <Button size="sm" variant="ghost" title="Restore" onPress={() => change(() => ok(api.client.POST('/api/v1/week-types/{week_type_id}/restore', { params: { path: { week_type_id: t.id } } })), { refresh })} />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function WeekTypeRow({
  type: t,
  first,
  last,
  onSave,
  onMove,
  onRemove,
}: {
  type: { name: string; colour: string; description: string; uses: number };
  first: boolean;
  last: boolean;
  onSave: (body: { name: string; colour: string; description: string }) => void;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(t.name);
  const [colour, setColour] = useState(t.colour);
  const [description, setDescription] = useState(t.description);
  const commit = () => {
    if (name.trim() !== t.name || colour !== t.colour || description.trim() !== t.description) onSave({ name: name.trim(), colour, description: description.trim() });
  };
  const tone = weekTypeColours(/^#[0-9a-fA-F]{6}$/.test(colour) ? colour : t.colour);
  return (
    <View style={styles.typeRow}>
      <View style={[styles.swatch, { backgroundColor: tone.colour }]} />
      <TextInput accessibilityLabel={`${t.name} colour`} value={colour} onChangeText={setColour} onBlur={commit} autoCapitalize="characters" maxLength={7} style={[styles.input, { width: 96 }]} />
      <TextInput accessibilityLabel={`${t.name} name`} value={name} onChangeText={setName} onBlur={commit} maxLength={40} style={[styles.input, { width: 170, fontFamily: fonts.semibold, color: tone.colour, backgroundColor: tone.light }]} />
      <TextInput accessibilityLabel={`${t.name} description`} value={description} onChangeText={setDescription} onBlur={commit} placeholder="What this week is for" placeholderTextColor={colors.ink4} maxLength={200} style={[styles.input, { flex: 1, minWidth: 200 }]} />
      <Text variant="tiny" tone="muted">
        used by {t.uses} week{t.uses === 1 ? '' : 's'}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${t.name} up`} disabled={first} onPress={() => onMove('up')}>
        <Feather name="arrow-up" size={15} color={first ? colors.line : colors.ink3} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Move ${t.name} down`} disabled={last} onPress={() => onMove('down')}>
        <Feather name="arrow-down" size={15} color={last ? colors.line : colors.ink3} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${t.name}`} onPress={onRemove}>
        <Feather name="trash-2" size={15} color={colors.ink4} />
      </Pressable>
    </View>
  );
}

/** The plan: what the gym has and uses, and for the owner Stripe's own pages (decision F). */
function Plan({ owner }: { owner: boolean }) {
  const me = useMe();
  const plans = usePlans(owner);
  const change = useChange();
  const e = me.data?.coach?.entitlements;
  if (!e) return null;
  const open = async (call: () => Promise<{ url: string }>) => {
    const answer = await change(call, { refresh: [] });
    if (answer) Linking.openURL(answer.url);
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text variant="h3">Plan</Text>
      <Text>
        {e.plan.name}
        {e.status ? ` · ${e.status.replace(/_/g, ' ')}` : ''}
      </Text>
      <Text variant="small" tone="muted">
        {e.athletes.used} athlete{e.athletes.used === 1 ? '' : 's'}
        {e.athletes.max !== null ? ` of ${e.athletes.max}` : ''} · form videos {e.form_videos ? 'included' : 'not included'}
        {e.programming ? '' : ' · programming is read-only until payment is sorted'}
      </Text>
      {owner ? (
        <>
          <View style={styles.row}>
            {(plans.data ?? []).map((p) => (
              <Button key={p.code} size="sm" variant={p.code === e.plan.code ? 'soft' : 'ghost'} title={p.code === e.plan.code ? `${p.name} (current)` : `Choose ${p.name}`} disabled={p.code === e.plan.code} onPress={() => open(() => ok(api.client.POST('/api/v1/billing/checkout', { body: { plan_code: p.code } })))} />
            ))}
          </View>
          <View style={{ alignSelf: 'flex-start' }}>
            <Button size="sm" variant="ghost" title="Manage billing" onPress={() => open(() => ok(api.client.POST('/api/v1/billing/portal')))} />
          </View>
        </>
      ) : (
        <Text variant="small" tone="muted">
          Ask the gym owner to change the plan or payment details.
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line2 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line2 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: colors.ink4, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.surface },
  swatch: { width: 18, height: 18, borderRadius: 5 },
});
