/**
 * One day of the board (the mockup's .day-col): its date and state, up to three sessions, and
 * each exercise as a card with the week type's colour on its edge. Its heading or "+ add
 * exercise" selects the day for the library rail. Click a card to edit it;
 * its menu (and, on the web, drag and drop or the ✕ on hover) moves or removes it.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { shortDay } from '@/training/format';
import { colors, fonts, radius, Text } from '@/ui';
import { confirm } from '@/ui/confirm';

import type { ProgramCommands } from './commands';
import { Draggable, DropZone } from './dnd';
import type { Day, Item, PlannedSession } from './queries';

const web = Platform.OS === 'web';

type Props = {
  day: Day;
  today: string;
  edge: string;
  selected: boolean;
  readOnly: boolean;
  list: boolean;
  commands: ProgramCommands;
  onSelect: () => void;
  onOpen: (item: Item) => void;
  onMenu: (item: Item) => void;
};

export function DayColumn({ day, today, edge, selected, readOnly, list, commands, onSelect, onOpen, onMenu }: Props) {
  const d = new Date(`${day.date}T00:00:00Z`);
  const named = day.sessions.length > 1 || day.sessions.some((s) => s.name);
  const state = day.done ? '✓ done' : day.date === today ? null : !day.sessions.length ? 'rest' : '';
  return (
    <DropZone id={`day-${day.id}`} data={{ dayId: day.id, sessionId: null, beforeItemId: null }}>
      <View style={[styles.col, list && styles.row, selected && styles.selected]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${shortDay(day.date)} ${d.getUTCDate()}${selected ? ', selected' : ''}`}
          accessibilityState={{ selected }}
          disabled={readOnly}
          onPress={onSelect}
          style={[styles.head, list && styles.headList]}
        >
          <Text style={styles.dow}>
            {shortDay(day.date)} <Text style={styles.date}>{d.getUTCDate()}</Text>
          </Text>
          {state === null ? <View accessibilityLabel="Today" style={styles.today} /> : state ? <Text style={[styles.state, day.done && { color: colors.good }]}>{state}</Text> : null}
        </Pressable>
        <View style={[styles.body, list && styles.bodyList]}>
          {day.sessions.map((session) => (
            <SessionBlock key={session.id} session={session} dayId={day.id} date={day.date} named={named} edge={edge} readOnly={readOnly} list={list} commands={commands} onOpen={onOpen} onMenu={onMenu} />
          ))}
          {!readOnly ? (
            <View style={styles.adds}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Add an exercise to ${shortDay(day.date)}`} onPress={onSelect} style={styles.addEx}>
                <Text style={styles.addText}>+ add exercise</Text>
              </Pressable>
              {day.sessions.length && day.sessions.length < 3 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Add a session on ${shortDay(day.date)}`} onPress={() => commands.addSession(day.id)} style={styles.addSession}>
                  <Feather name="plus" size={13} color={colors.ink3} />
                  <Text variant="tiny" tone="muted">
                    session
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </DropZone>
  );
}

function SessionBlock({
  session,
  dayId,
  date,
  named,
  edge,
  readOnly,
  list,
  commands,
  onOpen,
  onMenu,
}: {
  session: PlannedSession;
  dayId: string;
  date: string;
  named: boolean;
  edge: string;
  readOnly: boolean;
  list: boolean;
  commands: ProgramCommands;
  onOpen: (item: Item) => void;
  onMenu: (item: Item) => void;
}) {
  async function remove() {
    const n = session.items.length;
    if (await confirm('Remove this session?', `It has ${n} exercise${n === 1 ? '' : 's'}.`, 'Remove')) commands.removeSession(session);
  }

  return (
    <DropZone id={`session-${session.id}`} data={{ dayId, sessionId: session.id, beforeItemId: null }}>
      <View style={[styles.session, list && styles.sessionList]}>
        {named ? (
          <View style={styles.sessionHead}>
            <SessionName key={session.name} saved={session.name} readOnly={readOnly} onSave={(name) => commands.renameSession(session, name)} />
            {!readOnly ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${session.name || 'session'}`} onPress={remove} hitSlop={6}>
                <Feather name="x" size={13} color={colors.ink4} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {session.items.map((item) => (
          <View key={item.id} style={list ? styles.itemList : undefined}>
            {item.heading ? (
              <View style={styles.heading}>
                <Text style={styles.headingText}>{item.heading}</Text>
                {item.heading_note ? (
                  <Text variant="tiny" tone="muted">
                    {item.heading_note}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <DropZone id={`before-${item.id}`} data={{ dayId, sessionId: session.id, beforeItemId: item.id }}>
              <Draggable id={`item-${item.id}`} data={{ kind: 'item', itemId: item.id, name: item.exercise.name }} disabled={readOnly}>
                <ItemCard item={item} edge={edge} readOnly={readOnly} onOpen={() => onOpen(item)} onMenu={() => onMenu(item)} onRemove={() => commands.remove(item, date)} />
              </Draggable>
            </DropZone>
          </View>
        ))}
      </View>
    </DropZone>
  );
}

function SessionName({ saved, readOnly, onSave }: { saved: string; readOnly: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState(saved);
  return (
    <TextInput
      accessibilityLabel="Session name"
      editable={!readOnly}
      value={name}
      onChangeText={setName}
      onBlur={() => name.trim() !== saved && onSave(name.trim())}
      placeholder="Session name"
      placeholderTextColor={colors.ink4}
      maxLength={60}
      style={styles.sessionName}
    />
  );
}

function ItemCard({ item, edge, readOnly, onOpen, onMenu, onRemove }: { item: Item; edge: string; readOnly: boolean; onOpen: () => void; onMenu: () => void; onRemove: () => void }) {
  const [hover, setHover] = useState(false);
  const tools = !readOnly && (!web || hover);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.exercise.name}, ${item.summary}`}
      onPress={onOpen}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.card, { borderLeftColor: edge }, item.tag_slot && styles.tagSlot]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          {item.label ? <Text style={styles.label}>{item.label}</Text> : null}
          <Text style={styles.name} numberOfLines={2}>
            {item.exercise.name}
          </Text>
        </View>
        {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}
        {item.tag_slot ? <Text style={styles.slot}>tag slot</Text> : null}
      </View>
      {tools ? (
        <View style={styles.tools}>
          <Pressable accessibilityRole="button" accessibilityLabel={`More for ${item.exercise.name}`} onPress={onMenu} hitSlop={6}>
            <Feather name="more-horizontal" size={14} color={colors.ink3} />
          </Pressable>
          {web ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.exercise.name}`} onPress={onRemove} hitSlop={6}>
              <Feather name="x" size={14} color={colors.ink3} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  col: { flex: 1, minHeight: 150, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.m, padding: 6, gap: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', minHeight: 0, alignItems: 'flex-start', gap: 12 },
  selected: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandLight },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 4, paddingHorizontal: 2 },
  headList: { width: 76, paddingTop: 6 },
  dow: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.3 },
  date: { fontFamily: fonts.semibold, color: colors.ink4 },
  today: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  state: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink4 },
  body: { gap: 6, flex: 1 },
  bodyList: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  session: { gap: 5 },
  sessionList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sessionName: { flex: 1, fontFamily: fonts.bold, fontSize: 11.5, color: colors.ink2, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 6 },
  itemList: { width: 190 },
  heading: { paddingHorizontal: 2, paddingTop: 2 },
  headingText: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink3 },
  card: { flexDirection: 'row', gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 4, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
  tagSlot: { borderStyle: 'dashed' },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  label: { fontFamily: fonts.bold, fontSize: 10.5, color: colors.brand, backgroundColor: colors.brandLight, borderRadius: 4, paddingHorizontal: 4, overflow: 'hidden' },
  name: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink, flexShrink: 1 },
  summary: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3, marginTop: 1 },
  slot: { fontFamily: fonts.semibold, fontSize: 10, color: colors.brand, marginTop: 2 },
  tools: { gap: 6, alignItems: 'center' },
  adds: { gap: 2, marginTop: 'auto' },
  addEx: { paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center' },
  addText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink3 },
  addSession: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 3 },
});
