import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { uuid7 } from '@/domain/ids';
import { conversation, unread } from '@/domain/messages';
import { messageRead, messageSend, Refused } from '@/sync/actions';
import { useSync } from '@/sync/provider';
import { SyncNotices } from '@/sync/status';
import { sentAgo } from '@/training/format-time';
import { TrainingHeader } from '@/training/header';
import { useTraining } from '@/training/use-training';
import { colors, fonts, radius, space, Text } from '@/ui';

/** Messages with the coach (the mockup's #m-messages, the "Coach" tab), offline too. */
export default function Messages() {
  const world = useTraining();
  const { engine, profile } = useSync();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const messages = world ? conversation(world) : [];
  const waiting = world ? unread(world, profile.userId) : 0;
  const newest = messages.length ? messages[messages.length - 1].sent_at : null;
  useEffect(() => {
    // Seen while this tab is open: the coach's messages up to the newest one shown.
    if (focused && waiting && newest) engine.enqueue(messageRead, { until: newest }).catch(() => {});
  }, [focused, waiting, newest, engine]);

  if (!world) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  const coach = profile.coachName ?? 'your coach';
  const first = profile.coachName?.split(/\s+/)[0] ?? 'your coach';
  const now = new Date().toISOString();

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setProblem(null);
    try {
      await engine.enqueue(messageSend, { message_id: uuid7(), body });
      setDraft('');
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't send that. Try again.");
    }
  }

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <TrainingHeader />
      <SyncNotices />
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={styles.body} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
          <Text variant="h3">{profile.coachName ? `Coach ${coach}` : 'Coach'}</Text>
          {!world.coaching ? (
            <Text variant="small" tone="muted">
              You don&apos;t have a coach to message. Open the invite link your coach sends you to join them.
            </Text>
          ) : messages.length ? (
            messages.map((m) => {
              const mine = m.sender_id === profile.userId;
              return (
                <View key={m.id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text variant="small" style={mine ? { color: colors.white } : null}>
                    {m.body}
                  </Text>
                  <Text style={[styles.time, mine ? { color: 'rgba(255,255,255,0.75)' } : null]}>{sentAgo(m.sent_at, now, profile.timezone)}</Text>
                </View>
              );
            })
          ) : (
            <Text variant="small" tone="muted">
              No messages yet. Say hello to {first}.
            </Text>
          )}
          {problem ? (
            <Text variant="tiny" tone="bad" accessibilityRole="alert">
              {problem}
            </Text>
          ) : null}
        </ScrollView>
        {world.coaching ? (
          <View style={styles.compose}>
            <TextInput
              accessibilityLabel={`Message ${first}`}
              placeholder={`Message ${first}…`}
              placeholderTextColor={colors.ink4}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={send}
              returnKeyType="send"
              multiline
              style={styles.input}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} disabled={!draft.trim()} style={[styles.send, !draft.trim() && { opacity: 0.4 }]}>
              <Text style={styles.sendText}>↑</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 18, gap: space.s },
  bubble: { maxWidth: '85%', borderRadius: radius.l, paddingVertical: 9, paddingHorizontal: 13, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 6 },
  time: { fontSize: 10, color: colors.ink4 },
  compose: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.s,
    padding: space.m,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
  },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.white, fontFamily: fonts.extrabold, fontSize: 18 },
});
