/**
 * Programming › Exercises (the old library pages): the gym's exercises with search, tag
 * filters and archived ones; creating and editing; archiving, restoring and deleting for
 * good; categories and tags; and adding a starter pack's missing exercises.
 */
import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { Button, Card, colors, Field, fonts, Segmented, Select, Sheet, Text, useToast } from '@/ui';
import { confirm } from '@/ui/confirm';

import { useChange } from '../change';
import { useTags } from '../program/queries';
import { libraryKeys, useCategories, useExercises, useStarterPacks, type Exercise, type Impact } from './queries';

const MEASURES = [
  { value: 'reps', label: 'Reps' },
  { value: 'time', label: 'Time' },
  { value: 'distance', label: 'Distance' },
];

export function ExerciseLibrary({ readOnly }: { readOnly: boolean }) {
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Exercise | null>(null);
  const [organising, setOrganising] = useState(false);
  const [starters, setStarters] = useState(false);
  const exercises = useExercises(q.trim(), tags, archived);
  const allTags = useTags();
  const change = useChange();
  const list = exercises.data ?? [];

  async function archive(e: Exercise) {
    const tracked = e.tracked
      ? " It's also a tracked lift: it will be removed from onboarding and the Metrics tab (maxes already recorded are kept). Restoring it won't track it again automatically."
      : '';
    if (!(await confirm(`Archive “${e.name}”?`, `It disappears from the library but past sessions keep it. You can restore it later.${tracked}`, 'Archive'))) return;
    await change(() => ok(api.client.POST('/api/v1/exercises/{exercise_id}/archive', { params: { path: { exercise_id: e.id } } })), {
      said: (r) =>
        `“${e.name}” archived${r.was_tracked ? ' and removed from tracked lifts' : ''}${r.percent_users ? ` — ${r.percent_users} exercise${r.percent_users === 1 ? '' : 's'} still take percentages from it` : ''}`,
    });
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Feather name="search" size={14} color={colors.ink4} />
          <TextInput accessibilityLabel="Search the library" value={q} onChangeText={setQ} placeholder="Search name, tag or cue…" placeholderTextColor={colors.ink4} style={styles.searchInput} />
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: archived }} onPress={() => setArchived(!archived)} style={styles.check}>
          <View style={[styles.box, archived && styles.boxOn]}>{archived ? <Feather name="check" size={12} color={colors.white} /> : null}</View>
          <Text variant="small">Show archived</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Button title="Categories & tags" size="sm" variant="ghost" disabled={readOnly} onPress={() => setOrganising(true)} />
        <Button title="Add starter exercises" size="sm" variant="ghost" disabled={readOnly} onPress={() => setStarters(true)} />
        <Button title="+ New exercise" size="sm" disabled={readOnly} onPress={() => setEditing('new')} />
      </View>
      <View style={styles.chips}>
        {(allTags.data ?? []).map((t) => {
          const on = tags.includes(t.id);
          return (
            <Pressable key={t.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Tag ${t.name}`} onPress={() => setTags(on ? tags.filter((x) => x !== t.id) : [...tags, t.id])} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: colors.brand }]}>{t.name}</Text>
            </Pressable>
          );
        })}
        {allTags.data && !allTags.data.length ? (
          <Text variant="tiny" tone="muted">
            No tags yet
          </Text>
        ) : null}
      </View>
      <Text variant="tiny" tone="muted">
        {list.length} exercise{list.length === 1 ? '' : 's'}
        {q || tags.length ? ' matching' : ''}
      </Text>
      <Card padded={false}>
        {list.map((e, i) => (
          <View key={e.id} style={[styles.row, i > 0 && styles.rowLine]}>
            <View style={{ flex: 2, minWidth: 160 }}>
              <Text style={{ fontFamily: fonts.semibold }}>{e.name}</Text>
              {e.cue ? (
                <Text variant="tiny" tone="muted" numberOfLines={1}>
                  {e.cue}
                </Text>
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 110 }}>
              <Text variant="small">{e.category.name}</Text>
              {e.warmup || e.measure !== 'reps' ? (
                <Text variant="tiny" tone="muted">
                  {[e.warmup ? 'warm-up drill' : '', e.measure !== 'reps' ? `by ${e.measure}` : ''].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Text variant="tiny" tone="muted" style={{ flex: 1.3, minWidth: 120 }} numberOfLines={2}>
              {e.tags.map((t) => t.name).join(' · ')}
            </Text>
            <Text variant="tiny" tone="muted" style={{ width: 110 }}>
              {e.percent_of ? `% from ${e.percent_of.name}` : 'own max'}
            </Text>
            {e.youtube_url ? (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(e.youtube_url)} style={{ width: 80 }}>
                <Text variant="tiny" tone="brand" style={{ fontFamily: fonts.semibold }}>
                  YouTube ↗
                </Text>
              </Pressable>
            ) : (
              <Text variant="tiny" tone="faint" style={{ width: 80 }}>
                none
              </Text>
            )}
            <View style={styles.actions}>
              {e.archived ? (
                <>
                  <Button
                    title="Restore"
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    onPress={() => change(() => ok(api.client.POST('/api/v1/exercises/{exercise_id}/restore', { params: { path: { exercise_id: e.id } } })), { said: `“${e.name}” restored` })}
                  />
                  <Button title="Delete…" size="sm" variant="danger" disabled={readOnly} onPress={() => setDeleting(e)} />
                </>
              ) : (
                <>
                  <Button title="Edit" size="sm" variant="ghost" disabled={readOnly} onPress={() => setEditing(e)} />
                  <Button title="Archive" size="sm" variant="ghost" disabled={readOnly} onPress={() => archive(e)} />
                </>
              )}
            </View>
          </View>
        ))}
        {exercises.data && !list.length ? (
          <Text variant="small" tone="muted" style={{ padding: 16 }}>
            {archived ? 'No archived exercises.' : 'No exercises match. Try fewer tags or a shorter search.'}
          </Text>
        ) : null}
      </Card>
      <ExerciseSheet exercise={editing} onClose={() => setEditing(null)} />
      <DeleteSheet exercise={deleting} onClose={() => setDeleting(null)} />
      <OrganiseSheet open={organising} onClose={() => setOrganising(false)} />
      <StarterSheet open={starters} onClose={() => setStarters(false)} />
    </View>
  );
}

/** Creating or editing an exercise (the old _modal.html). Also opened from the board's rail. */
export function ExerciseSheet({ exercise, onClose, onSaved }: { exercise: Exercise | 'new' | null; onClose: () => void; onSaved?: (e: Exercise) => void }) {
  return exercise ? <ExerciseForm key={exercise === 'new' ? 'new' : exercise.id} exercise={exercise} onClose={onClose} onSaved={onSaved} /> : null;
}

function ExerciseForm({ exercise, onClose, onSaved }: { exercise: Exercise | 'new'; onClose: () => void; onSaved?: (e: Exercise) => void }) {
  const existing = exercise === 'new' ? null : exercise;
  const categories = useCategories();
  const tags = useTags();
  const everything = useExercises('', [], false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<string | null>(existing?.category.id ?? null);
  const [measure, setMeasure] = useState(existing?.measure ?? 'reps');
  const [percentOf, setPercentOf] = useState<string>(existing?.percent_of?.id ?? '');
  const [tagIds, setTagIds] = useState<string[]>(existing?.tags.map((t) => t.id) ?? []);
  const [youtube, setYoutube] = useState(existing?.youtube_url ?? '');
  const [cue, setCue] = useState(existing?.cue ?? '');
  const [warmup, setWarmup] = useState(existing?.warmup ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const bases = (everything.data ?? []).filter((e) => !e.percent_of && e.id !== existing?.id && e.measure === 'reps' && !e.warmup);

  async function save() {
    if (!name.trim()) return setErrors({ name: 'Give the exercise a name.' });
    if (!category) return setErrors({ category_id: 'Pick a category.' });
    const body = { name: name.trim(), category_id: category, measure, percent_of_id: percentOf || null, tag_ids: tagIds, youtube_url: youtube.trim(), cue: cue.trim(), warmup };
    setBusy(true);
    try {
      const saved = existing
        ? await ok(api.client.PUT('/api/v1/exercises/{exercise_id}', { params: { path: { exercise_id: existing.id } }, body }))
        : await ok(api.client.POST('/api/v1/exercises', { body }));
      await queryClient.invalidateQueries({ queryKey: ['coach'] });
      toast(existing ? `“${saved.name}” updated` : `“${saved.name}” added to the library`, 'good');
      onSaved?.(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(Object.keys(error.fields).length ? error.fields : { '': error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Edit exercise' : 'New exercise'}
      footer={
        <>
          <Button size="sm" variant="ghost" title="Cancel" onPress={onClose} />
          <Button size="sm" title="Save exercise" busy={busy} onPress={save} />
        </>
      }
    >
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Snatch Pull + Snatch complex" maxLength={80} error={errors.name} />
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          Category
        </Text>
        <Select label="Category" value={category} onChange={setCategory} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="Pick a category" />
        {errors.category_id ? (
          <Text variant="tiny" tone="bad">
            {errors.category_id}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          Measured in
        </Text>
        <Segmented label="Measured in" value={measure} onChange={setMeasure} options={MEASURES} />
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          Percentages worked from
        </Text>
        <Select label="Percentages worked from" value={percentOf} onChange={setPercentOf} options={[{ value: '', label: 'Its own max (or none)' }, ...bases.map((e) => ({ value: e.id, label: e.name }))]} />
        <Text variant="tiny" tone={errors.percent_of_id ? 'bad' : 'muted'}>
          {errors.percent_of_id ?? 'e.g. Front Squat percentages come from the Back Squat max.'}
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          Tags <Text variant="tiny" tone="muted">click to toggle — used for filtering when you program, and for tag-based slots in templates</Text>
        </Text>
        <View style={styles.chips}>
          {(tags.data ?? []).map((t) => {
            const on = tagIds.includes(t.id);
            return (
              <Pressable key={t.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Tag ${t.name}`} onPress={() => setTagIds(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && { color: colors.brand }]}>{t.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Field label="YouTube demo link" value={youtube} onChangeText={setYoutube} placeholder="https://youtube.com/…" autoCapitalize="none" error={errors.youtube_url} />
      <Field label="Coaching cue shown to athlete" value={cue} onChangeText={setCue} placeholder="e.g. Push the floor away, bar stays close" maxLength={200} error={errors.cue} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: warmup }} onPress={() => setWarmup(!warmup)} style={styles.check}>
        <View style={[styles.box, warmup && styles.boxOn]}>{warmup ? <Feather name="check" size={12} color={colors.white} /> : null}</View>
        <Text variant="small" style={{ flex: 1 }}>
          Warm-up drill — added to sessions as part of the warm-up checklist: the athlete taps its name for the demo and ticks it off, no sets to log.
        </Text>
      </Pressable>
      {errors[''] ? (
        <Text variant="small" tone="bad" accessibilityRole="alert">
          {errors['']}
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Deleting an archived exercise for good, after showing what goes and what stays. */
function DeleteSheet({ exercise, onClose }: { exercise: Exercise | null; onClose: () => void }) {
  const impact = useQuery({
    queryKey: [...libraryKeys.all, 'deletion', exercise?.id],
    queryFn: () => ok(api.client.GET('/api/v1/exercises/{exercise_id}/deletion', { params: { path: { exercise_id: exercise!.id } } })),
    enabled: Boolean(exercise),
  });
  const change = useChange();
  const i: Impact | undefined = impact.data;
  const lines = i
    ? [
        i.max_entries ? `${i.max_entries} max entr${i.max_entries === 1 ? 'y' : 'ies'} (${i.athletes.join(', ')})` : '',
        i.prescriptions ? `${i.prescriptions} prescription${i.prescriptions === 1 ? '' : 's'} in ${i.programmed_for.join(', ')}'s programs. Published weeks change for those athletes straight away.` : '',
        i.dependents.length ? `${i.dependents.join(', ')} will use their own max instead.` : '',
        i.slots_removed ? `${i.slots_removed} template slot${i.slots_removed === 1 ? '' : 's'} (${i.templates.join(', ')})` : '',
        i.slots_redefaulted ? `${i.slots_redefaulted} tag slot${i.slots_redefaulted === 1 ? '' : 's'} get a new default` : '',
        'The exercise itself, with its tags, demo link and cue.',
      ].filter(Boolean)
    : [];
  return (
    <Sheet
      open={Boolean(exercise)}
      onClose={onClose}
      title={exercise ? `Delete “${exercise.name}” permanently?` : ''}
      footer={
        <>
          <Button size="sm" variant="ghost" title="Keep it archived" onPress={onClose} />
          <Button
            size="sm"
            variant="danger"
            title="Delete permanently"
            disabled={!i}
            onPress={async () => {
              if (!exercise) return;
              const done = await change(() => ok(api.client.DELETE('/api/v1/exercises/{exercise_id}', { params: { path: { exercise_id: exercise.id } } })), { said: `“${exercise.name}” deleted` });
              if (done) onClose();
            }}
          />
        </>
      }
    >
      <Text variant="small" tone="muted">
        This can&apos;t be undone, and the exercise can&apos;t be restored afterwards.
      </Text>
      <Text variant="h4">What gets removed</Text>
      {lines.map((line) => (
        <Text key={line} variant="small">
          • {line}
        </Text>
      ))}
      {i?.logged ? (
        <>
          <Text variant="h4">What stays</Text>
          <Text variant="small">
            {i.logged} logged session{i.logged === 1 ? '' : 's'} by {i.logged_by.join(', ')} keep “{exercise?.name}” by name with every set. They stop counting towards its trends, PRs and “last done”.
          </Text>
        </>
      ) : null}
    </Sheet>
  );
}

/** Categories (ordered) and tags: add, rename, reorder, delete (the old organise.html). */
function OrganiseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const categories = useCategories();
  const tags = useTags();
  const change = useChange();
  const [newCategory, setNewCategory] = useState('');
  const [newTag, setNewTag] = useState('');
  const refresh = [libraryKeys.all, ['coach', 'tags'], ['coach', 'athlete']];

  async function removeCategory(c: { id: string; name: string; exercises: number }) {
    const others = (categories.data ?? []).filter((o) => o.id !== c.id);
    if (c.exercises && !others.length) {
      await confirm(`Delete category “${c.name}”?`, `It's your only category and it has ${c.exercises} exercises. Add another category first, so they have somewhere to go.`, 'OK');
      return;
    }
    const to = others[0];
    const message = c.exercises ? `${c.exercises} exercise${c.exercises === 1 ? ' is' : 's are'} in this category, including any archived ones. They move to “${to.name}”.` : 'No exercises use it.';
    if (!(await confirm(`Delete category “${c.name}”?`, message, c.exercises ? 'Move and delete' : 'Delete'))) return;
    await change(() => ok(api.client.POST('/api/v1/categories/{category_id}/delete', { params: { path: { category_id: c.id } }, body: { move_to_id: c.exercises ? to.id : null } })), {
      said: c.exercises ? `Moved ${c.exercises} exercise${c.exercises === 1 ? '' : 's'} to ${to.name} and deleted ${c.name}` : `Deleted ${c.name}`,
      refresh,
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Categories & tags">
      <Text variant="small" tone="muted">
        Your gym&apos;s own categories and tags. Changes apply to every exercise straight away.
      </Text>
      <Text variant="h4">Categories</Text>
      {(categories.data ?? []).map((c, i, all) => (
        <View key={c.id} style={styles.orgRow}>
          <NameInput key={c.name} label={`Category ${c.name}`} saved={c.name} onSave={(name) => change(() => ok(api.client.PATCH('/api/v1/categories/{category_id}', { params: { path: { category_id: c.id } }, body: { name } })), { refresh })} />
          <Text variant="tiny" tone="muted">
            {c.exercises} exercise{c.exercises === 1 ? '' : 's'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move ${c.name} up`} disabled={i === 0} onPress={() => change(() => ok(api.client.POST('/api/v1/categories/{category_id}/move', { params: { path: { category_id: c.id } }, body: { direction: 'up' } })), { refresh })}>
            <Feather name="arrow-up" size={15} color={i === 0 ? colors.line : colors.ink3} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move ${c.name} down`} disabled={i === all.length - 1} onPress={() => change(() => ok(api.client.POST('/api/v1/categories/{category_id}/move', { params: { path: { category_id: c.id } }, body: { direction: 'down' } })), { refresh })}>
            <Feather name="arrow-down" size={15} color={i === all.length - 1 ? colors.line : colors.ink3} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${c.name}`} onPress={() => removeCategory(c)}>
            <Feather name="trash-2" size={15} color={colors.ink4} />
          </Pressable>
        </View>
      ))}
      <View style={styles.orgRow}>
        <TextInput accessibilityLabel="New category" value={newCategory} onChangeText={setNewCategory} placeholder="New category, e.g. Hinge" placeholderTextColor={colors.ink4} style={[styles.input, { flex: 1 }]} />
        <Button
          size="sm"
          title="Add"
          disabled={!newCategory.trim()}
          onPress={async () => {
            if (await change(() => ok(api.client.POST('/api/v1/categories', { body: { name: newCategory.trim() } })), { refresh })) setNewCategory('');
          }}
        />
      </View>
      <Text variant="h4">Tags</Text>
      {(tags.data ?? []).map((t) => (
        <View key={t.id} style={styles.orgRow}>
          <NameInput key={t.name} label={`Tag ${t.name}`} saved={t.name} onSave={(name) => change(() => ok(api.client.PATCH('/api/v1/tags/{tag_id}', { params: { path: { tag_id: t.id } }, body: { name } })), { refresh })} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${t.name}`}
            onPress={async () => {
              if (await confirm(`Delete the tag “${t.name}”?`, 'It will be removed from every exercise that has it; the exercises themselves stay.', 'Delete'))
                change(() => ok(api.client.DELETE('/api/v1/tags/{tag_id}', { params: { path: { tag_id: t.id } } })), { refresh });
            }}
          >
            <Feather name="trash-2" size={15} color={colors.ink4} />
          </Pressable>
        </View>
      ))}
      <View style={styles.orgRow}>
        <TextInput accessibilityLabel="New tag" value={newTag} onChangeText={setNewTag} placeholder="New tag, e.g. upper-body" placeholderTextColor={colors.ink4} style={[styles.input, { flex: 1 }]} />
        <Button
          size="sm"
          title="Add"
          disabled={!newTag.trim()}
          onPress={async () => {
            if (await change(() => ok(api.client.POST('/api/v1/tags', { body: { name: newTag.trim() } })), { refresh })) setNewTag('');
          }}
        />
      </View>
    </Sheet>
  );
}

/** A name that saves when the field loses focus. Its parent keys it on the saved name, so a rename starts it afresh. */
function NameInput({ label, saved, onSave }: { label: string; saved: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(saved);
  return (
    <TextInput
      accessibilityLabel={label}
      value={name}
      onChangeText={setName}
      onBlur={() => name.trim() && name.trim() !== saved && onSave(name.trim())}
      maxLength={40}
      style={[styles.input, { flex: 1 }]}
    />
  );
}

function StarterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const packs = useStarterPacks();
  const change = useChange();
  return (
    <Sheet open={open} onClose={onClose} title="Add starter exercises">
      <Text variant="small" tone="muted">
        Adds only what your library doesn&apos;t have yet — nothing you&apos;ve edited, renamed or deleted comes back changed. Everything it adds is yours to edit.
      </Text>
      {(packs.data ?? [])
        .filter((p) => p.key !== 'empty')
        .map((p) => (
          <View key={p.key} style={styles.pack}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold }}>{p.label}</Text>
              <Text variant="tiny" tone="muted">
                {p.description}
              </Text>
            </View>
            <Button
              size="sm"
              title="Add"
              onPress={async () => {
                const done = await change(() => ok(api.client.POST('/api/v1/starter-exercises', { body: { pack: p.key } })), {
                  said: (r) => (r.added ? `Added ${r.added} exercise${r.added === 1 ? '' : 's'} from ${p.label}` : `Your library already has everything in ${p.label}`),
                });
                if (done) onClose();
              }}
            />
          </View>
        ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, minWidth: 240, flexGrow: 1, maxWidth: 380, backgroundColor: colors.surface },
  searchInput: { flex: 1, paddingVertical: 7, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: colors.ink4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  chipText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line2 },
  actions: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.surface },
  pack: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line2 },
});
