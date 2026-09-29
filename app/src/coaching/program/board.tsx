/**
 * The program board for one athlete (the mockup's Program tab, with the old coach screens'
 * features): the program and its weeks, the week's toolbar, seven days of sessions, the
 * exercise rail, habits, and applying templates with a preview. Every change goes through
 * `useProgramCommands`, so buttons, menus, drag and drop and Ctrl+Z all do the same thing.
 */
import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type LayoutChangeEvent } from 'react-native';

import { useMe } from '@/auth/me';
import { localDate } from '@/domain/dates';
import { dayMonth, shortDay } from '@/training/format';
import { Button, Card, colors, fonts, Segmented, Sheet, Text, useToast, weekTypeColours } from '@/ui';

import { Loading } from '../layout';
import { ApplyBar, GhostWeek, usePreview, type Source } from './apply';
import { useProgramCommands } from './commands';
import { DayColumn } from './day';
import { BoardDnd, type Dragged, type Target } from './dnd';
import { HabitsCard } from './habits';
import { findItem, moveTargets, placement } from './moves';
import { useApplySources, useBoard, type Choices, type Item, type Week } from './queries';
import { Rail } from './rail';
import { RxEditor } from './rx-editor';
import { SaveSheet, type SaveWhat } from './save-sheet';
import { StartProgram } from './start';
import { WeekToolbar } from './toolbar';
import { WeekTabs } from './week-tabs';

const web = Platform.OS === 'web';
const VIEW_KEY = 'boardView';

function storedList(): boolean {
  try {
    return web && globalThis.localStorage?.getItem(VIEW_KEY) === 'list';
  } catch {
    return false;
  }
}

/** Seven days in rows of this many columns, from the board's width (the mockup's 7 → 4 → 2). */
export function columnsFor(width: number): number {
  return width >= 840 ? 7 : width >= 520 ? 4 : width >= 300 ? 2 : 1;
}

export function ProgramBoard({ id, first, applyTemplate, onApplyDone }: { id: string; first: string; applyTemplate?: string; onApplyDone?: () => void }) {
  const me = useMe();
  const gym = me.data?.coach?.gym;
  const unit = gym?.units ?? 'kg';
  const readOnly = me.data?.coach?.entitlements ? !me.data.coach.entitlements.programming : false;
  const today = localDate(new Date().toISOString(), gym?.timezone ?? 'UTC');
  const toast = useToast();

  const [weekId, setWeekId] = useState<string | null>(null);
  const board = useBoard(id, weekId);
  const commands = useProgramCommands(id, first);
  const sources = useApplySources(id);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: Item; date: string } | null>(null);
  const [menu, setMenu] = useState<Item | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [saving, setSaving] = useState<SaveWhat | null>(null);
  const [list, setList] = useState(storedList);
  const [restart, setRestart] = useState(false);
  // Opened from Programming's "Apply to athlete…": straight into that template's preview.
  const [applying, setApplying] = useState<Choices | null>(applyTemplate ? { template_id: applyTemplate, days: null, mode: 'recent', start: '', publish: false } : null);
  const [ghost, setGhost] = useState<number | null>(applyTemplate ? 0 : null);
  const [seenApply, setSeenApply] = useState(applyTemplate);
  if (applyTemplate !== seenApply) {
    // Another "Apply to athlete…" while this board is open (tabs stay mounted).
    setSeenApply(applyTemplate);
    if (applyTemplate) {
      setApplying({ template_id: applyTemplate, days: null, mode: 'recent', start: '', publish: false });
      setGhost(0);
    }
  }
  const [confirming, setConfirming] = useState(false);
  const [width, setWidth] = useState(0);
  const [boardWidth, setBoardWidth] = useState(0);
  const preview = usePreview(id, applying);

  const data = board.data;
  const week = data?.week ?? null;

  // Ctrl/Cmd+Z undoes the last change to this week (not while typing).
  useEffect(() => {
    if (!web || !week || readOnly || applying) return;
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        event.preventDefault();
        commands.undo(week);
      }
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [week, readOnly, applying, commands]);

  const edge = weekTypeColours(week?.week_type?.colour ?? colors.ink4).colour;
  const day = week?.days.find((d) => d.id === selectedDay) ?? null;
  const wideLayout = width >= 1000;

  function setView(next: boolean) {
    setList(next);
    try {
      if (web) globalThis.localStorage?.setItem(VIEW_KEY, next ? 'list' : 'columns');
    } catch {
      // storage can be blocked; the choice then lasts for this visit
    }
  }

  function startApply(kind: 'program' | 'week') {
    const found = (sources.data ?? []).filter((s) => s.kind === kind);
    if (!found.length) {
      toast(kind === 'program' ? 'No templates yet. Build one under Programming' : 'No saved weeks yet. Save one from this board or from a template', 'bad');
      return;
    }
    setApplying({ template_id: found[0].id, days: null, mode: 'recent', start: '', publish: false });
    setGhost(0);
    setRestart(false);
    toast(`Previewing on ${first}'s board. Nothing is applied until you confirm`);
  }

  async function confirmApply() {
    if (!applying || !preview.data) return;
    setConfirming(true);
    const name = sources.data?.find((s) => s.id === applying.template_id)?.name ?? 'Template';
    const choices = { ...applying, days: preview.data.choices.days, start: preview.data.choices.start };
    const applied = await commands.apply(choices, name, preview.data.weeks[0]?.label ?? '');
    setConfirming(false);
    if (applied) {
      setApplying(null);
      setGhost(null);
      setWeekId(applied.first_week_id);
      onApplyDone?.();
    }
  }

  async function drop(what: Dragged, where: Target) {
    if (!week || readOnly) return;
    const place = placement(week, what, where);
    if (!place) return;
    if (place.kind === 'add') {
      await commands.add(place.exercise, place.day, place.sessionId ?? undefined, place.index ?? undefined);
      return;
    }
    await commands.move(place.item, place.sessionId ? { sessionId: place.sessionId } : { dayId: place.dayId }, place.index);
  }

  const rows = useMemo(() => {
    if (!week) return [];
    const cols = list ? 1 : columnsFor(boardWidth);
    const out = [];
    for (let i = 0; i < week.days.length; i += cols) out.push(week.days.slice(i, i + cols));
    return out;
  }, [week, list, boardWidth]);

  if (!data) return <Loading error={board.error} retry={() => board.refetch()} />;

  const shownGhost = ghost !== null ? preview.data?.weeks[ghost] : undefined;
  const applyArea = applying ? (
      <View style={{ gap: 12 }}>
        <ApplyBar
          choices={applying}
          onChange={(next) => {
            setApplying(next);
            setGhost(0);
          }}
          preview={preview.data}
          sources={(sources.data ?? []) as Source[]}
          first={first}
          current={data?.program?.name ?? null}
          weekStart={gym?.week_start ?? 0}
          busy={confirming}
          onCancel={() => {
            setApplying(null);
            setGhost(null);
            onApplyDone?.();
            toast('Apply cancelled. Nothing changed');
          }}
          onConfirm={confirmApply}
        />
        {shownGhost ? (
          <Card>
            <GhostWeek week={shownGhost} sourceName={sources.data?.find((s) => s.id === applying.template_id)?.name ?? ''} weekStart={gym?.week_start ?? 0} />
          </Card>
        ) : null}
      </View>
    ) : null;

  const lapsed = readOnly ? (
    <View style={styles.lapsed} accessibilityRole="alert">
      <Feather name="lock" size={14} color={colors.warn} />
      <Text variant="small" tone="ink2" style={{ flex: 1 }}>
        Your plan has lapsed, so programming is read-only. Your athletes can still train and log as usual.
      </Text>
    </View>
  ) : null;

  if (!data.program || restart) {
    return (
      <View style={{ gap: 12 }}>
        {lapsed}
        {!readOnly ? (
          <StartProgram
            first={first}
            today={today}
            weekStart={gym?.week_start ?? 0}
            weekTypes={data.week_types}
            hadOne={Boolean(data.program)}
            commands={commands}
            onDone={() => {
              setRestart(false);
              setWeekId(null);
            }}
          />
        ) : null}
        <View style={styles.row}>
          <Text variant="small" tone="muted">
            Or start from the library:
          </Text>
          <Button size="sm" variant="ghost" title="Apply a template" disabled={readOnly} onPress={() => startApply('program')} />
          <Button size="sm" variant="ghost" title="Apply a saved week" disabled={readOnly} onPress={() => startApply('week')} />
          {restart ? <Button size="sm" variant="ghost" title="Cancel" onPress={() => setRestart(false)} /> : null}
        </View>
        {applyArea}
      </View>
    );
  }

  const program = data.program;
  const fate: Record<string, 'replaced' | 'moves after'> = {};
  if (applying && preview.data) {
    for (const w of preview.data.replaced) fate[w] = 'replaced';
    for (const w of preview.data.moved) fate[w] = 'moves after';
  }

  return (
    <View style={{ gap: 12 }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {lapsed}
      <Card style={{ gap: 10 }}>
        <View style={styles.headRow}>
          <View style={{ flexShrink: 1 }}>
            <Text variant="h3">{program.name}</Text>
            <Text variant="tiny" tone="muted">
              started {dayMonth(program.start_date)} · {data.weeks.length} week{data.weeks.length === 1 ? '' : 's'}
            </Text>
          </View>
          <View style={[styles.row, { flexShrink: 1 }]}>
            <Button size="sm" variant="ghost" title="Start a new program" disabled={readOnly || Boolean(applying)} onPress={() => setRestart(true)} />
            <Button size="sm" variant="ghost" title="Save as template" disabled={readOnly || Boolean(applying)} onPress={() => setSaving({ kind: 'program', save: (n, d) => commands.saveProgram(n, d) })} />
            <Segmented
              label="Board layout"
              value={list ? 'list' : 'columns'}
              onChange={(v) => setView(v === 'list')}
              options={[
                { value: 'columns', label: 'Columns' },
                { value: 'list', label: 'List' },
              ]}
            />
          </View>
        </View>
        <ProgramNote key={program.note} note={program.note} first={first} readOnly={readOnly} onSave={(note) => commands.setProgramNote(note)} />
      </Card>

      <WeekTabs
        weeks={data.weeks}
        current={week?.id ?? null}
        today={today}
        onPick={(wid) => {
          setGhost(null);
          setWeekId(wid);
          setSelectedDay(null);
        }}
        onTemplate={() => startApply('program')}
        onSavedWeek={() => startApply('week')}
        onBlank={() => commands.addWeek()}
        locked={readOnly}
        preview={applying && preview.data ? { fate, ghosts: preview.data.weeks.map((w) => ({ label: w.label, start: w.start, week_type: w.week_type, sessions: w.days.length })), shown: ghost, onShow: setGhost } : undefined}
      />

      {applyArea}

      {week && !(applying && ghost !== null) ? (
        <>
          {!applying ? (
            <WeekToolbar
              week={week}
              weekTypes={data.week_types}
              first={first}
              commands={commands}
              readOnly={readOnly}
              onSave={() => setSaving({ kind: 'week', save: (n, d) => commands.saveWeek(week, n, d) })}
            />
          ) : null}
          <BoardDnd onDrop={drop}>
            <View style={[styles.layout, wideLayout && styles.layoutWide]}>
              <View style={{ flex: 1, gap: 8, minWidth: 0 }} onLayout={(e: LayoutChangeEvent) => setBoardWidth(e.nativeEvent.layout.width)}>
                {rows.map((row, r) => (
                  <View key={r} style={[styles.days, list && styles.daysList]}>
                    {row.map((d) => (
                      <View key={d.id} style={list ? undefined : { flex: 1, minWidth: 0 }}>
                        <DayColumn
                          day={d}
                          today={today}
                          edge={edge}
                          selected={d.id === selectedDay}
                          readOnly={readOnly || Boolean(applying)}
                          list={list}
                          commands={commands}
                          onSelect={() => {
                            const next = d.id === selectedDay ? null : d.id;
                            setSelectedDay(next);
                            if (next) toast(`${shortDay(d.date)} selected. Click + on a library exercise`);
                          }}
                          onOpen={(item) => setEditing({ item, date: d.date })}
                          onMenu={setMenu}
                        />
                      </View>
                    ))}
                    {!list && row.length < columnsFor(boardWidth) ? Array.from({ length: columnsFor(boardWidth) - row.length }, (_, i) => <View key={`gap-${i}`} style={{ flex: 1 }} />) : null}
                  </View>
                ))}
                <Text variant="tiny" tone="muted">
                  {web ? 'Drag exercises from the library onto a day (or click a day, then +). ' : 'Tap a day, then + on a library exercise. '}
                  Click an exercise to edit it{web ? ', drag it to move it, or hover for ✕ to remove it' : '; its ⋯ menu moves or removes it'}. The coloured edge follows the week type.
                </Text>
              </View>
              {!applying ? (
                <View style={wideLayout ? styles.railWide : undefined}>
                  <Rail
                    athleteId={id}
                    first={first}
                    dayLabel={day ? dayMonth(day.date) : null}
                    readOnly={readOnly}
                    onAdd={(exercise) => {
                      if (!day) return toast('Click a day on the board first', 'bad');
                      commands.add(exercise, day);
                    }}
                  />
                </View>
              ) : null}
            </View>
          </BoardDnd>
        </>
      ) : !week ? (
        <Text variant="small" tone="muted">
          This program has no weeks. Add one above.
        </Text>
      ) : null}

      <HabitsCard athleteId={id} readOnly={readOnly} commands={commands} />

      <RxEditor athleteId={id} item={editing?.item ?? null} date={editing?.date ?? ''} unit={unit} readOnly={readOnly} commands={commands} onClose={() => setEditing(null)} />
      <ItemMenu
        item={menu}
        week={week}
        onClose={() => setMenu(null)}
        onEdit={(item, date) => setEditing({ item, date })}
        onMove={setMoving}
        onRemove={(item, date) => commands.remove(item, date)}
        onSaveSession={(item) => {
          const found = week ? findItem(week, item.id) : null;
          const session = found && week?.days.find((d) => d.id === found.dayId)?.sessions.find((s) => s.id === found.sessionId);
          if (session) setSaving({ kind: 'session', save: (n, d) => commands.saveSession(session, n, d) });
        }}
      />
      <Sheet open={Boolean(moving)} onClose={() => setMoving(null)} title={moving ? `Move ${moving.exercise.name} to…` : ''}>
        {moving && week
          ? moveTargets(week, moving.id).map(({ label, target }) => (
              <Pressable
                key={`${target.dayId}-${target.sessionId}`}
                accessibilityRole="button"
                onPress={() => {
                  const item = moving;
                  setMoving(null);
                  drop({ kind: 'item', itemId: item.id, name: item.exercise.name }, target);
                }}
                style={styles.option}
              >
                <Text style={{ fontFamily: fonts.semibold }}>{label}</Text>
              </Pressable>
            ))
          : null}
      </Sheet>
      <SaveSheet what={saving} onClose={() => setSaving(null)} />
    </View>
  );
}

function ItemMenu({
  item,
  week,
  onClose,
  onEdit,
  onMove,
  onRemove,
  onSaveSession,
}: {
  item: Item | null;
  week: Week | null;
  onClose: () => void;
  onEdit: (item: Item, date: string) => void;
  onMove: (item: Item) => void;
  onRemove: (item: Item, date: string) => void;
  onSaveSession: (item: Item) => void;
}) {
  const found = item && week ? findItem(week, item.id) : null;
  const date = week?.days.find((d) => d.id === found?.dayId)?.date ?? '';
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Sheet open={Boolean(item)} onClose={onClose} title={item?.exercise.name ?? ''}>
      {item ? (
        <View style={{ gap: 8 }}>
          <Button variant="ghost" block title="Edit sets and reps" onPress={act(() => onEdit(item, date))} />
          <Button variant="ghost" block title="Move to…" onPress={act(() => onMove(item))} />
          <Button variant="ghost" block title="Save this session to the library" onPress={act(() => onSaveSession(item))} />
          <Button variant="danger" block title="Remove from day" onPress={act(() => onRemove(item, date))} />
        </View>
      ) : null}
    </Sheet>
  );
}

function ProgramNote({ note, first, readOnly, onSave }: { note: string; first: string; readOnly: boolean; onSave: (note: string) => void }) {
  const [open, setOpen] = useState(Boolean(note));
  const [text, setText] = useState(note);
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.noteHead}>
        <Feather name={open ? 'chevron-down' : 'chevron-right'} size={14} color={colors.ink3} />
        <Text variant="label" tone="ink2">
          Program note{note ? '' : ` (goal, rest, nutrition; shown to ${first} with the program)`}
        </Text>
      </Pressable>
      {open ? (
        <TextInput
          accessibilityLabel="Program note"
          editable={!readOnly}
          multiline
          value={text}
          onChangeText={setText}
          onBlur={() => text.trim() !== note && onSave(text.trim())}
          placeholder="e.g. Goal: get strong and healthy. Rest as needed on all lifts."
          placeholderTextColor={colors.ink4}
          maxLength={2000}
          style={styles.note}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  headRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  lapsed: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.warnLight },
  layout: { gap: 12 },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start' },
  railWide: { width: 290 },
  days: { flexDirection: 'row', gap: 8 },
  daysList: { flexDirection: 'column' },
  option: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { minHeight: 70, borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, padding: 10, fontSize: 14, fontFamily: fonts.regular, color: colors.ink, textAlignVertical: 'top' },
});
