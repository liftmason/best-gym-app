/**
 * Programming › Templates, Weeks, Sessions (the mockup's .tpl-grid): the library's cards, "+ New",
 * and applying one to an athlete (their board opens with the preview).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, ok } from '@/api';
import { Button, Card, Chip, colors, fonts, Sheet, Text } from '@/ui';

import { useChange } from '../change';
import { useRoster } from '../queries';
import { libraryKeys, useTemplates, type Kind, type TemplateCard } from './queries';

const INTRO: Record<Kind, string> = {
  program: 'A template is a whole program — any number of weeks, each with its own sessions. Apply it to an athlete at whatever weekly frequency suits them.',
  week: 'Reusable single weeks — build them from saved sessions, save one out of a template or an athlete’s board, then drop it into any template or program.',
  session: 'Reusable sessions — the building blocks of weeks. Build one here, or save one out of any week or template with the bookmark control on its card.',
};
const EMPTY: Record<Kind, string> = {
  program: 'No templates yet — build one here, or save an athlete’s program as a template from their board.',
  week: 'No saved weeks yet — build one here, or save a week out of a template or an athlete’s board.',
  session: 'No saved sessions yet — build one here, or save one out of a week or template.',
};
const NEW: Record<Kind, string> = { program: '+ New template', week: '+ New week', session: '+ New session' };

function stats(card: TemplateCard): string {
  const s = card.stats;
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  if (card.kind === 'program')
    return [n(s.weeks, 'week'), n(s.sessions, 'session'), `written for ${card.sessions_per_week}×/week`, s.tag_slots ? n(s.tag_slots, 'tag slot') : '', s.habits ? n(s.habits, 'habit') : '']
      .filter(Boolean)
      .join(' · ');
  if (card.kind === 'week') return [n(s.sessions, 'session'), n(s.slots, 'exercise slot'), s.tag_slots ? `${s.tag_slots} tag-based` : ''].filter(Boolean).join(' · ');
  return [n(s.slots, 'exercise slot'), s.tag_slots ? `${s.tag_slots} tag-based` : ''].filter(Boolean).join(' · ');
}

export function TemplateList({ kind, readOnly }: { kind: Kind; readOnly: boolean }) {
  const cards = useTemplates(kind);
  const change = useChange();
  const [applying, setApplying] = useState<TemplateCard | null>(null);

  async function create() {
    const made = await change(() => ok(api.client.POST('/api/v1/templates', { body: { kind } })), { refresh: [libraryKeys.all] });
    if (made) router.push(`/programming/${made.id}`);
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.head}>
        <Text variant="small" tone="muted" style={{ flex: 1, minWidth: 240 }}>
          {INTRO[kind]}
        </Text>
        <Button title={NEW[kind]} size="sm" disabled={readOnly} onPress={create} />
      </View>
      {cards.data && !cards.data.length ? (
        <Text variant="small" tone="muted">
          {EMPTY[kind]}
        </Text>
      ) : null}
      <View style={styles.grid}>
        {(cards.data ?? []).map((card) => (
          <Card key={card.id} style={styles.card}>
            <View style={styles.row}>
              <Chip label={kind === 'session' ? 'Session' : kind === 'week' ? 'Week' : 'Template'} tone="brand" />
              <Text variant="tiny" tone="muted">
                used {card.used}×
              </Text>
            </View>
            <Text variant="h4">{card.name || (kind === 'program' ? 'Untitled template' : kind === 'week' ? 'Untitled week' : 'Untitled session')}</Text>
            {card.description ? (
              <Text variant="small" tone="muted" numberOfLines={2}>
                {card.description}
              </Text>
            ) : null}
            <Text variant="tiny" tone="ink2">
              {stats(card)}
            </Text>
            {kind === 'session' && card.exercises.length ? (
              <Text variant="tiny" tone="muted" numberOfLines={1}>
                {card.exercises.slice(0, 3).join(' · ')}
                {card.exercises.length > 3 ? ` +${card.exercises.length - 3}` : ''}
              </Text>
            ) : null}
            <View style={[styles.row, { marginTop: 'auto' }]}>
              <Button title="Open" size="sm" variant="ghost" onPress={() => router.push(`/programming/${card.id}`)} />
              {kind !== 'session' ? (
                <Button title={kind === 'program' ? 'Apply to athlete…' : 'Add to athlete…'} size="sm" variant="soft" disabled={readOnly} onPress={() => setApplying(card)} />
              ) : null}
            </View>
          </Card>
        ))}
      </View>
      <ApplyToAthlete card={applying} onClose={() => setApplying(null)} />
    </View>
  );
}

/** "Apply to an athlete": pick who, then their board opens with the preview (nothing is applied until they confirm). */
export function ApplyToAthlete({ card, onClose }: { card: { id: string; name: string } | null; onClose: () => void }) {
  const roster = useRoster('name', '');
  return (
    <Sheet open={Boolean(card)} onClose={onClose} title="Apply to an athlete">
      <Text variant="small" tone="muted">
        Next you&apos;ll see “{card?.name}” laid onto their board — pick training days and where it starts, review every week, then confirm. Nothing is applied until then.
      </Text>
      {(roster.data ?? []).map(({ athlete: a }) => (
        <Pressable
          key={a.id}
          accessibilityRole="button"
          onPress={() => {
            onClose();
            if (card) router.push(`/athletes/${a.id}?tab=program&edit=1&apply=${card.id}`);
          }}
          style={styles.athlete}
        >
          <Text style={{ fontFamily: fonts.semibold, flex: 1 }}>{a.name}</Text>
          <Text variant="small" tone="brand" style={{ fontFamily: fonts.semibold }}>
            Preview on their board →
          </Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { flexGrow: 1, flexBasis: 280, maxWidth: 420, gap: 8, minHeight: 190 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  athlete: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
});
