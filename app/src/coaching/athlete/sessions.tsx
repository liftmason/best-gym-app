/** An athlete's Sessions tab (the mockup's #tab-sessions): each session in full, with its issues and form videos. */
import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, ok, type components } from '@/api';
import { dayMonth } from '@/training/format';
import { Button, Card, Chip, colors, fonts, radius, space, Text, WeekPill } from '@/ui';

import { GRAPE, GRAPE_LIGHT } from '../kinds';
import { Loading } from '../layout';
import { keys } from '../queries';
import { RpePill } from '../rpe';

import { VideoSheet } from './video-sheet';

type Session = components['schemas']['SessionOut'];
type Video = components['schemas']['Video'];

const RANGES: [string, string][] = [
  ['4', 'Last 4 weeks'],
  ['8', 'Last 8 weeks'],
  ['all', 'All time'],
];
const KIND: Record<string, string> = {
  pain: 'Pain / possible injury',
  equipment: 'Equipment not available',
  prescription: 'Prescription looks wrong',
  other: 'Something else',
};

function SessionCard({
  s,
  open,
  onToggle,
  onResolve,
  onVideo,
  focus,
}: {
  s: Session;
  open: boolean;
  onToggle: () => void;
  onResolve: (id: string) => void;
  onVideo: (v: Video) => void;
  focus?: string;
}) {
  const worry = s.issues.some((i) => !i.resolved);
  const count = s.exercises.length;
  return (
    <Card style={{ gap: space.s }} padded>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${dayMonth(s.date)} · ${s.name}`} onPress={onToggle} style={styles.summary}>
        <View style={[styles.status, worry ? { backgroundColor: colors.warnLight } : { backgroundColor: colors.goodLight }]}>
          <Feather name={worry ? 'alert-triangle' : s.finished ? 'check' : 'clock'} size={14} color={worry ? colors.warn : colors.good} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text variant="small" style={styles.bold} numberOfLines={1}>
            {dayMonth(s.date)} · {s.name}
          </Text>
          <View style={styles.pills}>
            {s.pr_day ? <Chip tone="good" label="PR day" /> : null}
            {s.week_type ? <WeekPill name={s.week_type.name} colour={s.week_type.colour} /> : null}
            <Text variant="tiny" tone="muted">
              {count} exercise{count === 1 ? '' : 's'}
              {s.answers.length ? '' : ' · check-in skipped'}
              {s.logged_late ? ' · logged afterwards' : ''}
              {!s.finished ? ' · not finished' : ''}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <RpePill rpe={s.rpe} />
          {s.readiness ? (
            <Text variant="tiny" tone="muted">
              readiness {s.readiness}/10
            </Text>
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <View style={{ gap: space.s }}>
          <Text style={styles.label}>Pre-workout check-in</Text>
          {s.answers.length ? (
            s.answers.map((a, i) => (
              <View key={i} style={styles.pair}>
                <Text variant="tiny" tone="muted" style={{ flex: 1 }}>
                  {a.question}
                </Text>
                <Text variant="tiny" style={[styles.bold, styles.right]}>
                  {a.type === 'scale' ? `${a.value} / 10` : a.value || '—'}
                  {a.other ? ` — ${a.other}` : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text variant="tiny" tone="muted">
              Skipped
            </Text>
          )}
          <Text style={styles.label}>Work logged</Text>
          {s.warmup ? (
            <Text variant="tiny" tone="muted">
              Warm-up: {s.warmup.done}/{s.warmup.total} drills
            </Text>
          ) : null}
          {s.exercises.map((e, i) => (
            <View key={i} style={styles.exercise}>
              <View style={styles.pair}>
                <Text variant="tiny" style={[styles.bold, { flex: 1 }]}>
                  {e.name}
                  {e.deleted ? ' (removed from the library)' : ''}
                </Text>
                {e.pr ? <Chip tone="good" label="PR" /> : null}
              </View>
              <Text variant="tiny">{e.did || 'no sets logged'}</Text>
              <Text variant="tiny" tone="muted">
                {[e.asked && `asked ${e.asked}`, `${e.done_count}/${e.planned} sets`, e.e1rm && `e1RM ${e.e1rm}`].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ))}
          <Text style={styles.label}>Post-workout</Text>
          <View style={styles.pair}>
            <Text variant="tiny" tone="muted">
              Session RPE
            </Text>
            <Text variant="tiny" style={styles.bold}>
              {s.rpe ? `${s.rpe} / 10` : '—'}
            </Text>
          </View>
          {s.comment ? (
            <View style={styles.note}>
              <Text variant="tiny">“{s.comment}”</Text>
            </View>
          ) : null}
          {s.issues.map((i) => (
            <View key={i.id} style={[styles.note, { backgroundColor: colors.badLight }, focus === `issue-${i.id}` && styles.focus]}>
              <Text variant="tiny" tone="bad" style={styles.bold}>
                Issue reported: {KIND[i.kind] ?? i.kind}
                {i.resolved ? ' · resolved' : ''}
              </Text>
              {i.text ? <Text variant="tiny">{i.text}</Text> : null}
              {!i.resolved ? <Button title="Resolve" size="sm" variant="ghost" onPress={() => onResolve(i.id)} /> : null}
            </View>
          ))}
          {s.videos.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityLabel={`Form video: ${v.exercise}. ${v.reviewed ? 'Reviewed' : 'Watch and review'}`}
              onPress={() => onVideo(v)}
              style={[styles.note, { backgroundColor: GRAPE_LIGHT, flexDirection: 'row', alignItems: 'center', gap: space.s }, focus === `video-${v.id}` && styles.focus]}
            >
              <Feather name="play-circle" size={18} color={GRAPE} />
              <View style={{ flex: 1 }}>
                <Text variant="tiny" style={[styles.bold, { color: GRAPE }]}>
                  Form video: {v.exercise}
                </Text>
                <Text variant="tiny" tone="muted">
                  {!v.available ? 'Removed after 90 days' : v.reviewed ? `Reviewed${v.feedback ? ` — ${v.feedback}` : ''}` : v.note ? `“${v.note}”` : 'Waiting for your review'}
                </Text>
              </View>
              {!v.reviewed ? <Text variant="tiny" style={[styles.bold, { color: GRAPE }]}>Review</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function Sessions({ id, first, focus, range: initialRange }: { id: string; first: string; focus?: string; range?: string }) {
  const [range, setRange] = useState(initialRange ?? '8');
  const [q, setQ] = useState('');
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [video, setVideo] = useState<Video | null>(null);
  const queryClient = useQueryClient();
  const key = [...keys.athlete(id), 'sessions', range, q.trim()];
  const sessions = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      ok(api.client.GET('/api/v1/athletes/{athlete_id}/sessions', { params: { path: { athlete_id: id }, query: { range, q: q.trim(), before: pageParam, limit: 20 } } })),
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const items = sessions.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.athlete(id) }), queryClient.invalidateQueries({ queryKey: ['coach', 'feed'] })]);
  const isOpen = (s: Session) =>
    opened[s.id] ??
    (focus === `session-${s.id}` || s.issues.some((i) => focus === `issue-${i.id}`) || s.videos.some((v) => focus === `video-${v.id}`) || items.indexOf(s) === 0);

  return (
    <View style={{ gap: space.m }}>
      <TextInput accessibilityLabel="Filter by exercise" placeholder="Filter by exercise…" placeholderTextColor={colors.ink4} value={q} onChangeText={setQ} style={styles.filter} />
      <View style={styles.pills}>
        {RANGES.map(([value, label]) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: range === value }} onPress={() => setRange(value)} style={[styles.range, range === value && styles.rangeOn]}>
            <Text variant="tiny" style={[styles.bold, range === value && { color: colors.brand }]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {sessions.data ? (
        items.length ? (
          items.map((s) => (
            <SessionCard
              key={s.id}
              s={s}
              focus={focus}
              open={isOpen(s)}
              onToggle={() => setOpened({ ...opened, [s.id]: !isOpen(s) })}
              onResolve={async (issue) => {
                await ok(api.client.POST('/api/v1/athletes/{athlete_id}/issues/{issue_id}/resolve', { params: { path: { athlete_id: id, issue_id: issue } } })).catch(() => {});
                await refresh();
              }}
              onVideo={setVideo}
            />
          ))
        ) : (
          <Text variant="small" tone="muted">
            No sessions in range.
          </Text>
        )
      ) : (
        <Loading error={sessions.error} retry={() => sessions.refetch()} />
      )}
      {sessions.hasNextPage ? <Button title="Show more" variant="ghost" busy={sessions.isFetchingNextPage} onPress={() => sessions.fetchNextPage()} /> : null}
      <VideoSheet athleteId={id} video={video} first={first} onClose={() => setVideo(null)} onReviewed={refresh} />
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  status: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  bold: { fontFamily: fonts.bold },
  right: { textAlign: 'right', flexShrink: 1 },
  label: { fontSize: 10.5, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.ink3, marginTop: 4 },
  pair: { flexDirection: 'row', justifyContent: 'space-between', gap: space.s },
  exercise: { gap: 1, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.line2 },
  note: { borderRadius: radius.m, padding: space.s, gap: 2, backgroundColor: colors.surface2 },
  focus: { borderWidth: 2, borderColor: colors.brand },
  filter: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.m, paddingHorizontal: 12, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 14, color: colors.ink, backgroundColor: colors.surface },
  range: { borderWidth: 1, borderColor: colors.line, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surface },
  rangeOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
});
