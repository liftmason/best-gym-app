/** An athlete's Messages tab (the mockup's #tab-messages): the thread, oldest first; seeing it marks it read. */
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { Button, colors, enterSends, fonts, radius, space, Text } from '@/ui';

import { Loading } from '../layout';
import { keys } from '../queries';
import { agoFrom } from '../time';

export function Messages({ id, first }: { id: string; first: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const thread = useInfiniteQuery({
    queryKey: [...keys.athlete(id), 'messages'],
    queryFn: ({ pageParam }) => ok(api.client.GET('/api/v1/athletes/{athlete_id}/messages', { params: { path: { athlete_id: id }, query: { before: pageParam, limit: 50 } } })),
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 20_000,
  });
  const messages = (thread.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();
  const unread = messages.some((m) => m.sender === 'athlete' && !m.read);

  useEffect(() => {
    if (!unread) return;
    ok(api.client.POST('/api/v1/athletes/{athlete_id}/messages/read', { params: { path: { athlete_id: id } } }))
      .then(() => Promise.all(['feed', 'threads', 'dashboard'].map((k) => queryClient.invalidateQueries({ queryKey: ['coach', k] }))))
      .catch(() => {});
  }, [unread, id, queryClient]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setProblem(null);
    try {
      await ok(api.client.POST('/api/v1/athletes/{athlete_id}/messages', { params: { path: { athlete_id: id } }, body: { body } }));
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: [...keys.athlete(id), 'messages'] });
      await queryClient.invalidateQueries({ queryKey: ['coach', 'threads'] });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Couldn't send. Try again.");
    }
  }

  if (!thread.data) return <Loading error={thread.error} retry={() => thread.refetch()} />;
  return (
    <View style={{ gap: space.s }}>
      {thread.hasNextPage ? <Button title="Earlier messages" variant="ghost" size="sm" onPress={() => thread.fetchNextPage()} /> : null}
      {messages.length ? (
        messages.map((m) => {
          const mine = m.sender === 'coach';
          return (
            <View key={m.id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text variant="small" style={mine ? { color: colors.white } : undefined}>
                {m.body}
              </Text>
              <Text style={[styles.time, mine ? { color: 'rgba(255,255,255,0.75)' } : undefined]}>{agoFrom(m.sent_at)}</Text>
            </View>
          );
        })
      ) : (
        <Text variant="small" tone="muted">
          No messages yet.
        </Text>
      )}
      <View style={styles.compose}>
        <TextInput
          accessibilityLabel={`Message ${first}`}
          placeholder="Message this athlete…"
          placeholderTextColor={colors.ink4}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          onKeyPress={(event) => enterSends(send)(event)}
          returnKeyType="send"
          multiline
          style={styles.input}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!draft.trim()} onPress={send} style={[styles.send, !draft.trim() && { opacity: 0.4 }]}>
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
      {problem ? (
        <Text variant="tiny" tone="bad">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: radius.l, paddingVertical: 9, paddingHorizontal: 13, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 6 },
  time: { fontSize: 10, color: colors.ink4 },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s, marginTop: space.s },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1.5, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, backgroundColor: colors.surface },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 18 },
});
