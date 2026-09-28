/**
 * The template editor (the mockup's #panel-tpledit, with the old editor's features): one
 * screen for a program template, a saved week or a saved session. Weeks hold sessions, which
 * hold slots (a fixed exercise, or a tag slot resolved per athlete). Changes save as they're
 * made; templates have no undo.
 */
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { useMe } from '@/auth/me';
import { Button, Card, colors, Field, fonts, radius, Select, Sheet, Text, useToast, weekTypeColours } from '@/ui';
import { confirm } from '@/ui/confirm';

import { useChange } from '../change';
import { BoardDnd, Draggable, DropZone, type Dragged, type Target } from '../program/dnd';
import { DoseFields } from '../program/dose-form';
import { useTags } from '../program/queries';
import { SaveSheet, type SaveWhat } from '../program/save-sheet';
import { CADENCES } from '../program/habits';
import { ApplyToAthlete } from './lists';
import { libraryKeys, useExercises, useSaved, useSlot, useTemplate, useWeekTypes, type Editor, type Slot, type TemplateSession, type TemplateWeek } from './queries';

const web = Platform.OS === 'web';
const EMOJI = ['🍎', '😴', '💧', '🧘', '🚶', '🥩', '🥗', '⚖️', '💪', '📓'];
const KIND_NAME = { program: 'template', week: 'week', session: 'session' } as const;

/** Where a slot dropped before `beforeId` (or at the end) lands, counting the session's other slots. */
export function slotIndex(session: TemplateSession, slotId: string, beforeId: string | null): number {
  const others = session.slots.filter((s) => s.id !== slotId);
  const before = beforeId ? others.findIndex((s) => s.id === beforeId) : -1;
  return before >= 0 ? before : others.length;
}

export function TemplateEditor({ id, readOnly }: { id: string; readOnly: boolean }) {
  const template = useTemplate(id);
  const change = useChange();
  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [moving, setMoving] = useState<Slot | null>(null);
  const [saving, setSaving] = useState<SaveWhat | null>(null);
  const [picking, setPicking] = useState<{ kind: 'week' | 'session'; weekId?: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [points, setPoints] = useState('');
  const refresh = [libraryKeys.all];
  const t = template.data;
  if (!t) return null;
  const kind = t.kind as 'program' | 'week' | 'session';
  const p = { template_id: id };
  const sessions = t.weeks.flatMap((w) => w.sessions.map((s) => ({ week: w, session: s })));
  const chosen = sessions.find((x) => x.session.id === selected) ?? null;

  const run = <T,>(fn: () => Promise<T>, said?: string | ((r: T) => string | null)) => change(fn, { said, refresh });

  async function drop(what: Dragged, where: Target) {
    if (readOnly || !where.sessionId) return;
    const target = sessions.find((x) => x.session.id === where.sessionId)?.session;
    if (!target) return;
    if (what.kind === 'exercise') {
      const index = where.beforeItemId ? target.slots.findIndex((s) => s.id === where.beforeItemId) : -1;
      await run(() => ok(api.client.POST('/api/v1/templates/{template_id}/template-sessions/{template_session_id}/slots', { params: { path: { ...p, template_session_id: target.id } }, body: { exercise_id: what.exercise.id, tag_ids: [], index: index >= 0 ? index : null } })));
      return;
    }
    await run(() => ok(api.client.POST('/api/v1/templates/{template_id}/slots/{slot_id}/move', { params: { path: { ...p, slot_id: what.itemId } }, body: { session_id: target.id, index: slotIndex(target, what.itemId, where.beforeItemId) } })));
  }

  async function remove() {
    if (!(await confirm(`Delete “${t!.name || `this ${KIND_NAME[kind]}`}”?`, 'Programs it was applied to keep their weeks.', 'Delete'))) return;
    const done = await change(() => ok(api.client.DELETE('/api/v1/templates/{template_id}', { params: { path: p } })), { said: 'Deleted', refresh: [libraryKeys.all] });
    if (done !== undefined) router.replace(`/programming?tab=${kind === 'program' ? 'templates' : `${kind}s`}`);
  }

  const summary = [
    kind !== 'session' ? `${t.stats.weeks} week${t.stats.weeks === 1 ? '' : 's'}` : '',
    kind !== 'session' ? `${t.stats.sessions} session${t.stats.sessions === 1 ? '' : 's'}` : '',
    `${t.stats.slots} exercise slot${t.stats.slots === 1 ? '' : 's'}`,
    `${t.stats.tag_slots} tag-based`,
    kind === 'program' ? `At ${t.sessions_per_week}×/week this runs ${t.stats.calendar_weeks} calendar week${t.stats.calendar_weeks === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.row}>
        <Button title="← Programming" size="sm" variant="ghost" onPress={() => router.push(`/programming?tab=${kind === 'program' ? 'templates' : `${kind}s`}`)} />
        <View style={{ flex: 1 }} />
        {kind !== 'session' ? <Button title={kind === 'program' ? 'Apply to athlete' : 'Add to athlete'} size="sm" variant="soft" disabled={readOnly} onPress={() => setApplying(true)} /> : null}
        <Button title="Delete" size="sm" variant="danger" disabled={readOnly} onPress={remove} />
      </View>

      <Meta key={`${t.name}|${t.description}|${t.program_note}|${t.sessions_per_week}`} editor={t} readOnly={readOnly} onSave={(body) => run(() => ok(api.client.PATCH('/api/v1/templates/{template_id}', { params: { path: p }, body })))} />

      <View style={styles.summary}>
        <Text variant="small" tone="ink2">
          {summary.join(' · ')}
        </Text>
        <Text variant="tiny" tone="muted">
          {kind === 'week'
            ? 'A saved week can be dropped into any template, or straight onto an athlete’s program.'
            : kind === 'session'
              ? 'Saved sessions are dropped into weeks and templates with “+ From saved session”.'
              : 'Select a session, then add exercises from the library. Use a tag slot when the exact exercise should be chosen per athlete — it fills with their most recent matching lift (or the default) and can be swapped on their board.'}{' '}
          Changes save as you make them; templates have no undo.
        </Text>
      </View>

      <BoardDnd onDrop={drop}>
        <View style={styles.layout}>
          <View style={{ flex: 1, minWidth: 0, gap: 14 }}>
            {t.weeks.map((week, wi) => (
              <WeekBlock
                key={week.id}
                week={week}
                index={wi}
                kind={kind}
                selected={selected}
                readOnly={readOnly}
                onSelect={setSelected}
                onOpenSlot={setSlot}
                onMoveSlot={setMoving}
                run={run}
                templateId={id}
                onSave={(what) => setSaving(what)}
                onPickSession={() => setPicking({ kind: 'session', weekId: week.id })}
              />
            ))}
            {!t.weeks.length ? (
              <Text variant="small" tone="muted">
                No weeks yet — add the first week below.
              </Text>
            ) : null}
            {kind === 'program' && !readOnly ? (
              <View style={styles.row}>
                <Button
                  size="sm"
                  variant="ghost"
                  title={t.weeks.length ? '+ Add week — copy of the last week' : '+ Add week'}
                  onPress={() =>
                    run(
                      () => ok(api.client.POST('/api/v1/templates/{template_id}/weeks', { params: { path: p }, body: { points } })),
                      () => (t.weeks.length ? `Week ${t.weeks.length + 1} added as a copy of the previous week${points ? `, percentages ${Number(points) > 0 ? '+' : ''}${points}` : ''}` : 'First week added'),
                    )
                  }
                />
                {t.weeks.length ? (
                  <>
                    <TextInput accessibilityLabel="Percentage points heavier" value={points} onChangeText={setPoints} placeholder="0" placeholderTextColor={colors.ink4} keyboardType="numbers-and-punctuation" style={[styles.input, { width: 64 }]} />
                    <Text variant="small" tone="muted">
                      % points heavier
                    </Text>
                  </>
                ) : null}
                <Button size="sm" variant="ghost" title="+ From saved week" onPress={() => setPicking({ kind: 'week' })} />
              </View>
            ) : null}
            {kind === 'program' ? <TemplateHabits editor={t} readOnly={readOnly} run={run} /> : null}
          </View>
          <View style={styles.rail}>
            <TemplateRail
              chosen={chosen ? { label: kind === 'session' ? chosen.session.name || 'Session' : `${chosen.week.label} · ${chosen.session.name || 'Session'}` } : null}
              readOnly={readOnly}
              onAdd={(exercise) =>
                chosen
                  ? run(() => ok(api.client.POST('/api/v1/templates/{template_id}/template-sessions/{template_session_id}/slots', { params: { path: { ...p, template_session_id: chosen.session.id } }, body: { exercise_id: exercise.id, tag_ids: [] } })))
                  : run(() => Promise.reject(new ApiError(400, 'no_session', 'Select a session on the left first')))
              }
              onTagSlot={(tagIds) =>
                chosen
                  ? run(
                      () => ok(api.client.POST('/api/v1/templates/{template_id}/template-sessions/{template_session_id}/slots', { params: { path: { ...p, template_session_id: chosen.session.id } }, body: { tag_ids: tagIds } })),
                      'Tag slot added',
                    )
                  : run(() => Promise.reject(new ApiError(400, 'no_session', 'Select a session on the left first')))
              }
            />
          </View>
        </View>
      </BoardDnd>

      <SlotSheet templateId={id} slot={slot} readOnly={readOnly} onClose={() => setSlot(null)} />
      <Sheet open={Boolean(moving)} onClose={() => setMoving(null)} title={moving ? `Move ${moving.exercise.name} to…` : ''}>
        {moving
          ? sessions.map(({ week, session }) => (
              <Pressable
                key={session.id}
                accessibilityRole="button"
                onPress={() => {
                  const s = moving;
                  setMoving(null);
                  run(() => ok(api.client.POST('/api/v1/templates/{template_id}/slots/{slot_id}/move', { params: { path: { ...p, slot_id: s.id } }, body: { session_id: session.id, index: slotIndex(session, s.id, null) } })));
                }}
                style={styles.option}
              >
                <Text style={{ fontFamily: fonts.semibold }}>
                  {kind === 'session' ? session.name || 'Session' : `${week.label} · ${session.name || 'Session'}`}
                </Text>
              </Pressable>
            ))
          : null}
      </Sheet>
      <PickSaved templateId={id} picking={picking} onClose={() => setPicking(null)} run={run} />
      <SaveSheet what={saving} onClose={() => setSaving(null)} />
      <ApplyToAthlete card={applying ? { id, name: t.name || 'this template' } : null} onClose={() => setApplying(false)} />
    </View>
  );
}

function Meta({ editor: t, readOnly, onSave }: { editor: Editor; readOnly: boolean; onSave: (body: { name?: string; description?: string; program_note?: string; sessions_per_week?: number }) => void }) {
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description);
  const [note, setNote] = useState(t.program_note);
  const kind = t.kind;
  const placeholder = kind === 'program' ? 'e.g. 12-Week Competition Cycle' : kind === 'week' ? 'e.g. Accumulation — 3 day' : 'e.g. A — Snatch + Squat';
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.row}>
        <View style={{ flex: 2, minWidth: 240 }}>
          <Field label={kind === 'program' ? 'Template name' : kind === 'week' ? 'Week name' : 'Session name'} value={name} editable={!readOnly} onChangeText={setName} onBlur={() => name.trim() !== t.name && onSave({ name: name.trim() })} placeholder={placeholder} maxLength={80} />
        </View>
        {kind === 'program' ? (
          <View style={{ gap: 6, minWidth: 180 }}>
            <Text variant="label" tone="ink2">
              Written for
            </Text>
            <Select
              label="Written for"
              disabled={readOnly}
              value={String(t.sessions_per_week)}
              onChange={(v) => onSave({ sessions_per_week: Number(v) })}
              options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} session${n === 1 ? '' : 's'} / week` }))}
            />
          </View>
        ) : null}
      </View>
      <Field label="Description" value={description} editable={!readOnly} onChangeText={setDescription} onBlur={() => description.trim() !== t.description && onSave({ description: description.trim() })} placeholder="Who this is for and what it emphasises" maxLength={300} />
      {kind === 'program' ? (
        <Field
          label="Program note — goal, rest, nutrition; becomes the athlete's program note when applied as a new program"
          value={note}
          editable={!readOnly}
          multiline
          onChangeText={setNote}
          onBlur={() => note.trim() !== t.program_note && onSave({ program_note: note.trim() })}
          maxLength={2000}
        />
      ) : null}
    </Card>
  );
}

type Run = <T>(fn: () => Promise<T>, said?: string | ((r: T) => string | null)) => Promise<T | undefined>;

function WeekBlock({
  week,
  index,
  kind,
  selected,
  readOnly,
  onSelect,
  onOpenSlot,
  onMoveSlot,
  run,
  templateId,
  onSave,
  onPickSession,
}: {
  week: TemplateWeek;
  index: number;
  kind: 'program' | 'week' | 'session';
  selected: string | null;
  readOnly: boolean;
  onSelect: (id: string | null) => void;
  onOpenSlot: (slot: Slot) => void;
  onMoveSlot: (slot: Slot) => void;
  run: Run;
  templateId: string;
  onSave: (what: SaveWhat) => void;
  onPickSession: () => void;
}) {
  const types = useWeekTypes();
  const tone = weekTypeColours(week.week_type?.colour ?? colors.ink4);
  const p = { template_id: templateId, template_week_id: week.id };
  const typeOptions = (types.data ?? []).filter((t) => !t.archived || t.id === week.week_type?.id).map((t) => ({ value: t.id, label: t.name }));

  async function removeWeek() {
    if (await confirm(`Remove week ${index + 1} and its sessions?`, "This can't be undone.", 'Remove')) run(() => ok(api.client.DELETE('/api/v1/templates/{template_id}/weeks/{template_week_id}', { params: { path: p } })), 'Week removed');
  }

  return (
    <View style={[styles.week, { borderTopColor: tone.colour }]}>
      {kind !== 'session' ? (
        <View style={styles.row}>
          <Text variant="h4">{kind === 'week' ? 'Week' : week.label}</Text>
          <View style={{ minWidth: 170 }}>
            <Select compact label="Week type" disabled={readOnly} value={week.week_type?.id ?? null} onChange={(week_type_id) => run(() => ok(api.client.PATCH('/api/v1/templates/{template_id}/weeks/{template_week_id}', { params: { path: p }, body: { week_type_id } })))} options={typeOptions} />
          </View>
          <Text variant="tiny" tone="muted">
            {week.sessions.length} session{week.sessions.length === 1 ? '' : 's'}
          </Text>
          <View style={{ flex: 1 }} />
          {!readOnly ? (
            <>
              <Button size="sm" variant="ghost" title="+ From saved session" onPress={onPickSession} />
              <Button size="sm" variant="ghost" title="+ Session" onPress={() => run(() => ok(api.client.POST('/api/v1/templates/{template_id}/weeks/{template_week_id}/sessions', { params: { path: p }, body: {} })))} />
              {kind === 'program' ? (
                <>
                  <Button size="sm" variant="ghost" title="Save week" onPress={() => onSave({ kind: 'week', save: (name, description) => run(() => ok(api.client.POST('/api/v1/templates/{template_id}/weeks/{template_week_id}/save', { params: { path: p }, body: { name, description } })), (c) => `“${c.name}” saved — find it under Programming › Weeks`) })} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Duplicate ${week.label}`} onPress={() => run(() => ok(api.client.POST('/api/v1/templates/{template_id}/weeks/{template_week_id}/duplicate', { params: { path: p } })), `Week ${index + 1} duplicated`)}>
                    <Feather name="copy" size={16} color={colors.ink3} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${week.label}`} onPress={removeWeek}>
                    <Feather name="trash-2" size={16} color={colors.ink3} />
                  </Pressable>
                </>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
      <View style={styles.sessions}>
        {week.sessions.map((session) => (
          <SessionCard key={session.id} session={session} weekId={week.id} edge={tone.colour} selected={selected === session.id} kind={kind} readOnly={readOnly} onSelect={() => onSelect(selected === session.id ? null : session.id)} onOpenSlot={onOpenSlot} onMoveSlot={onMoveSlot} run={run} templateId={templateId} onSave={onSave} />
        ))}
        {!week.sessions.length ? (
          <Text variant="small" tone="muted">
            No sessions in this week yet.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SessionCard({
  session,
  weekId,
  edge,
  selected,
  kind,
  readOnly,
  onSelect,
  onOpenSlot,
  onMoveSlot,
  run,
  templateId,
  onSave,
}: {
  session: TemplateSession;
  weekId: string;
  edge: string;
  selected: boolean;
  kind: string;
  readOnly: boolean;
  onSelect: () => void;
  onOpenSlot: (slot: Slot) => void;
  onMoveSlot: (slot: Slot) => void;
  run: Run;
  templateId: string;
  onSave: (what: SaveWhat) => void;
}) {
  const [name, setName] = useState(session.name);
  const p = { template_id: templateId, template_session_id: session.id };
  async function remove() {
    const n = session.slots.length;
    if (await confirm(`Remove ${session.name || 'this session'} and its ${n} exercise${n === 1 ? '' : 's'}?`, "This can't be undone.", 'Remove'))
      run(() => ok(api.client.DELETE('/api/v1/templates/{template_id}/template-sessions/{template_session_id}', { params: { path: p } })));
  }
  return (
    <DropZone id={`tsession-${session.id}`} data={{ dayId: weekId, sessionId: session.id, beforeItemId: null }}>
      <View style={[styles.session, selected && styles.sessionOn]}>
        <View style={styles.sessionHead}>
          <TextInput
            accessibilityLabel="Session name"
            editable={!readOnly && kind !== 'session'}
            value={name}
            onChangeText={setName}
            onBlur={() => name.trim() !== session.name && run(() => ok(api.client.PATCH('/api/v1/templates/{template_id}/template-sessions/{template_session_id}', { params: { path: p }, body: { name: name.trim() || 'Session' } })))}
            maxLength={60}
            style={styles.sessionName}
          />
          {!readOnly && kind !== 'session' ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Save ${session.name || 'session'} to the session library`}
                onPress={() => onSave({ kind: 'session', save: (n, d) => run(() => ok(api.client.POST('/api/v1/templates/{template_id}/template-sessions/{template_session_id}/save', { params: { path: p }, body: { name: n, description: d } })), (c) => `“${c.name}” saved — find it under Programming › Sessions`) })}
              >
                <Feather name="bookmark" size={15} color={colors.ink3} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${session.name || 'session'}`} onPress={remove}>
                <Feather name="trash-2" size={15} color={colors.ink3} />
              </Pressable>
            </>
          ) : null}
        </View>
        {session.slots.map((slot) => (
          <View key={slot.id}>
            {slot.heading ? <Text style={styles.heading}>{slot.heading}</Text> : null}
            <DropZone id={`tbefore-${slot.id}`} data={{ dayId: weekId, sessionId: session.id, beforeItemId: slot.id }}>
              <Draggable id={`slot-${slot.id}`} data={{ kind: 'item', itemId: slot.id, name: slot.exercise.name }} disabled={readOnly}>
                <SlotCard slot={slot} edge={edge} readOnly={readOnly} onOpen={() => onOpenSlot(slot)} onMenu={() => onMoveSlot(slot)} onRemove={() => run(() => ok(api.client.DELETE('/api/v1/templates/{template_id}/slots/{slot_id}', { params: { path: { template_id: templateId, slot_id: slot.id } } })))} />
              </Draggable>
            </DropZone>
          </View>
        ))}
        {!session.slots.length ? (
          <Text variant="tiny" tone="muted">
            No exercises yet
          </Text>
        ) : null}
        {!readOnly ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Add an exercise to ${session.name || 'this session'}`} onPress={onSelect} style={styles.addEx}>
            <Text style={styles.addText}>{selected ? 'Adding here — pick from the library' : '+ add exercise'}</Text>
          </Pressable>
        ) : null}
      </View>
    </DropZone>
  );
}

function SlotCard({ slot, edge, readOnly, onOpen, onMenu, onRemove }: { slot: Slot; edge: string; readOnly: boolean; onOpen: () => void; onMenu: () => void; onRemove: () => void }) {
  const [hover, setHover] = useState(false);
  const tools = !readOnly && (!web || hover);
  const tag = slot.kind === 'tag';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${slot.exercise.name}, ${slot.summary}`} onPress={onOpen} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={[styles.slot, { borderLeftColor: edge }, tag && { borderStyle: 'dashed' }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.slotName} numberOfLines={2}>
          {slot.label ? `${slot.label} ` : ''}
          {tag ? `Tag slot · default ${slot.exercise.name}` : slot.exercise.name}
        </Text>
        <Text style={styles.slotSummary}>{slot.summary}</Text>
        {tag ? <Text style={styles.slotTags}>{slot.tags.map((t) => t.name).join(' · ')}</Text> : null}
      </View>
      {tools ? (
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move ${slot.exercise.name}`} onPress={onMenu} hitSlop={6}>
            <Feather name="more-horizontal" size={14} color={colors.ink3} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${slot.exercise.name}`} onPress={onRemove} hitSlop={6}>
            <Feather name="x" size={14} color={colors.ink3} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The library beside the editor: A–Z, no athlete history. "+ Tag slot" uses the ticked tags. */
function TemplateRail({ chosen, readOnly, onAdd, onTagSlot }: { chosen: { label: string } | null; readOnly: boolean; onAdd: (e: { id: string; name: string }) => void; onTagSlot: (tagIds: string[]) => void }) {
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const exercises = useExercises(q.trim(), tags, false);
  const allTags = useTags();
  const list = exercises.data ?? [];
  return (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      <View style={{ padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <Text variant="h4">Exercise library</Text>
        <TextInput accessibilityLabel="Search exercises" value={q} onChangeText={setQ} placeholder="Search exercises…" placeholderTextColor={colors.ink4} style={styles.input} />
        <View style={styles.chips}>
          {(allTags.data ?? []).map((t) => {
            const on = tags.includes(t.id);
            return (
              <Pressable key={t.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Tag ${t.name}`} onPress={() => setTags(on ? tags.filter((x) => x !== t.id) : [...tags, t.id])} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && { color: colors.brand }]}>{t.name}</Text>
              </Pressable>
            );
          })}
        </View>
        {!readOnly ? <Button size="sm" variant="soft" title={tags.length ? `+ Tag slot (${list.length} qualify)` : '+ Tag slot'} disabled={!tags.length || !list.length} onPress={() => onTagSlot(tags)} /> : null}
      </View>
      <View style={{ maxHeight: 560 }}>
        {list.map((e) => (
          <Draggable key={e.id} id={`trail-${e.id}`} data={{ kind: 'exercise', exercise: { id: e.id, name: e.name } }} disabled={readOnly}>
            <View style={styles.railItem}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cat}>{e.category.name}</Text>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5 }}>{e.name}</Text>
              </View>
              {!readOnly ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Add ${e.name} as a fixed exercise`} onPress={() => onAdd(e)} style={styles.plus}>
                  <Feather name="plus" size={16} color={colors.brand} />
                </Pressable>
              ) : null}
            </View>
          </Draggable>
        ))}
        {exercises.data && !list.length ? (
          <Text variant="small" tone="muted" style={{ padding: 14 }}>
            No exercises carry all of those tags.
          </Text>
        ) : null}
      </View>
      <Text variant="tiny" tone="muted" style={{ padding: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
        {chosen ? `Adding to ${chosen.label}` : 'Select a session first'}
      </Text>
    </Card>
  );
}

/** A slot: fixed or tag-based, and its dose (the dose fields are the board's). */
function SlotSheet({ templateId, slot, readOnly, onClose }: { templateId: string; slot: Slot | null; readOnly: boolean; onClose: () => void }) {
  const detail = useSlot(templateId, slot?.id ?? null);
  if (!slot) return null;
  return detail.data ? <SlotForm key={`${slot.id}:${detail.dataUpdatedAt}`} templateId={templateId} detail={detail.data} readOnly={readOnly} onClose={onClose} /> : null;
}

function SlotForm({ templateId, detail, readOnly, onClose }: { templateId: string; detail: NonNullable<ReturnType<typeof useSlot>['data']>; readOnly: boolean; onClose: () => void }) {
  const change = useChange();
  const queryClient = useQueryClient();
  const toast = useToast();
  const unit = useMe().data?.coach?.gym.units ?? 'kg';
  const exercises = useExercises('', [], false);
  const tags = useTags();
  const [kind, setKind] = useState(detail.kind);
  const [exercise, setExercise] = useState<string | null>(detail.exercise.id);
  const [tagIds, setTagIds] = useState(detail.tags.map((t) => t.id));
  const [dose, setDose] = useState(detail.dose);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const all = exercises.data ?? [];
  const qualifying = all.filter((e) => tagIds.every((t) => e.tags.some((x) => x.id === t)));
  const p = { template_id: templateId, slot_id: detail.id };

  async function save() {
    setBusy(true);
    try {
      await ok(api.client.PUT('/api/v1/templates/{template_id}/slots/{slot_id}', { params: { path: p }, body: kind === 'tag' ? { kind, default_id: exercise, tag_ids: tagIds, dose } : { kind, exercise_id: exercise, tag_ids: [], dose } }));
      await queryClient.invalidateQueries({ queryKey: libraryKeys.all });
      toast('Slot saved', 'good');
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
      title={`${detail.exercise.name} · slot`}
      footer={
        <>
          <Button size="sm" variant="danger" title="Remove slot" disabled={readOnly} onPress={async () => (await change(() => ok(api.client.DELETE('/api/v1/templates/{template_id}/slots/{slot_id}', { params: { path: p } })), { refresh: [libraryKeys.all] })) && onClose()} />
          <View style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" title="Cancel" onPress={onClose} />
          <Button size="sm" title="Save" busy={busy} disabled={readOnly} onPress={save} />
        </>
      }
    >
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          Slot type
        </Text>
        <View style={styles.row}>
          {(['exercise', 'tag'] as const).map((k) => (
            <Button key={k} size="sm" variant={kind === k ? 'brand' : 'ghost'} title={k === 'exercise' ? 'Fixed exercise' : 'Tag-based'} onPress={() => setKind(k)} />
          ))}
        </View>
        <Text variant="tiny" tone="muted">
          {kind === 'exercise' ? 'The same exercise for every athlete this template is applied to.' : 'Resolved per athlete from the tags — their most recent matching lift, or the default below.'}
        </Text>
      </View>
      {kind === 'tag' ? (
        <View style={{ gap: 6 }}>
          <Text variant="label" tone="ink2">
            Tags <Text variant="tiny" tone="muted">an exercise must carry all of these to qualify</Text>
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
      ) : null}
      <View style={{ gap: 6 }}>
        <Text variant="label" tone="ink2">
          {kind === 'tag' ? `Default exercise — ${tagIds.length ? `${qualifying.length} qualify` : 'pick tags to narrow the pool'}` : 'Exercise'}
        </Text>
        <Select label={kind === 'tag' ? 'Default exercise' : 'Exercise'} value={exercise} onChange={setExercise} options={(kind === 'tag' ? qualifying : all).map((e) => ({ value: e.id, label: `${e.name} — ${e.category.name}` }))} placeholder="Pick an exercise" />
        {errors.exercise_id || errors.default_id || errors.tag_ids ? (
          <Text variant="tiny" tone="bad">
            {errors.exercise_id ?? errors.default_id ?? errors.tag_ids}
          </Text>
        ) : null}
      </View>
      <DoseFields dose={dose} onChange={setDose} errors={errors} unit={unit} />
    </Sheet>
  );
}

function PickSaved({ templateId, picking, onClose, run }: { templateId: string; picking: { kind: 'week' | 'session'; weekId?: string } | null; onClose: () => void; run: Run }) {
  const saved = useSaved(templateId, picking?.kind ?? null);
  return (
    <Sheet open={Boolean(picking)} onClose={onClose} title={picking?.kind === 'week' ? 'Add a saved week' : 'Add a saved session'}>
      {saved.data && !saved.data.length ? (
        <Text variant="small" tone="muted">
          Nothing saved yet — save a {picking?.kind} from a template or an athlete&apos;s board first.
        </Text>
      ) : null}
      {(saved.data ?? []).map((card) => (
        <Pressable
          key={card.id}
          accessibilityRole="button"
          onPress={() => {
            const what = picking!;
            onClose();
            run(
              () => ok(api.client.POST('/api/v1/templates/{template_id}/use-saved', { params: { path: { template_id: templateId } }, body: { kind: what.kind, source_id: card.id, template_week_id: what.weekId ?? null } })),
              `“${card.name}” added`,
            );
          }}
          style={styles.option}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.semibold }}>{card.name}</Text>
            <Text variant="tiny" tone="muted">
              {card.stats.sessions} sessions · {card.stats.slots} slots{card.description ? ` — ${card.description}` : ''}
            </Text>
          </View>
          <Text variant="small" tone="brand" style={{ fontFamily: fonts.semibold }}>
            Use
          </Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

function TemplateHabits({ editor: t, readOnly, run }: { editor: Editor; readOnly: boolean; run: Run }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [cadence, setCadence] = useState('daily');
  const [note, setNote] = useState('');
  const p = { template_id: t.id };
  return (
    <Card style={{ gap: 10 }}>
      <View>
        <Text variant="h4">Habits prescribed with this program</Text>
        <Text variant="tiny" tone="muted">
          added to the athlete&apos;s habit list when the template is applied
        </Text>
      </View>
      {t.habits.length ? (
        t.habits.map((h) => (
          <View key={h.id} style={styles.row}>
            <Text style={{ fontSize: 18 }}>{h.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold }}>{h.name}</Text>
              <Text variant="tiny" tone="muted">
                {CADENCES.find((c) => c.value === h.cadence)?.label ?? h.cadence}
                {h.note ? ` · ${h.note}` : ''}
              </Text>
            </View>
            {!readOnly ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${h.name}`} onPress={() => run(() => ok(api.client.DELETE('/api/v1/templates/{template_id}/habits/{template_habit_id}', { params: { path: { ...p, template_habit_id: h.id } } })))}>
                <Feather name="trash-2" size={15} color={colors.ink4} />
              </Pressable>
            ) : null}
          </View>
        ))
      ) : (
        <Text variant="small" tone="muted">
          No habits yet — anything added here is prescribed to the athlete when this template is applied.
        </Text>
      )}
      {!readOnly ? (
        <View style={styles.row}>
          <TextInput accessibilityLabel="Habit name" value={name} onChangeText={setName} placeholder="e.g. Sleep 8 hours" placeholderTextColor={colors.ink4} maxLength={80} style={[styles.input, { flex: 2, minWidth: 160 }]} />
          <Select compact label="Emoji" value={emoji} onChange={setEmoji} options={EMOJI.map((e) => ({ value: e, label: e }))} />
          <Select compact label="How often" value={cadence} onChange={setCadence} options={CADENCES} />
          <TextInput accessibilityLabel="Habit note" value={note} onChangeText={setNote} placeholder="Why or when (optional)" placeholderTextColor={colors.ink4} maxLength={200} style={[styles.input, { flex: 1.5, minWidth: 140 }]} />
          <Button
            size="sm"
            title="+ Add habit"
            disabled={!name.trim()}
            onPress={async () => {
              if (await run(() => ok(api.client.POST('/api/v1/templates/{template_id}/habits', { params: { path: p }, body: { name: name.trim(), emoji, cadence, note: note.trim() } })))) {
                setName('');
                setNote('');
              }
            }}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  summary: { gap: 4, paddingHorizontal: 4 },
  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' },
  rail: { width: 300, flexGrow: 1, maxWidth: 360 },
  week: { gap: 10, padding: 14, borderRadius: radius.l, borderWidth: 1, borderColor: colors.line, borderTopWidth: 4, backgroundColor: colors.surface },
  sessions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  session: { width: 230, gap: 6, padding: 10, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg },
  sessionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandLight },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionName: { flex: 1, fontFamily: fonts.bold, fontSize: 13, color: colors.ink, paddingVertical: 3, paddingHorizontal: 4, borderRadius: 6 },
  heading: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink3, paddingTop: 2 },
  slot: { flexDirection: 'row', gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
  slotName: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  slotSummary: { fontSize: 11.5, color: colors.ink3, fontFamily: fonts.regular },
  slotTags: { fontSize: 10.5, color: colors.brand, fontFamily: fonts.semibold, marginTop: 2 },
  addEx: { paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center' },
  addText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink3 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13.5, fontFamily: fonts.regular, color: colors.ink, backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  chipText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink3 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.line2, backgroundColor: colors.surface },
  cat: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink4 },
  plus: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.brandLight, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
});
