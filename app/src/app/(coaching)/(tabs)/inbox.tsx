import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { CoachScreen, Loading } from '@/coaching/layout';
import { useThreads } from '@/coaching/queries';
import { agoFrom } from '@/coaching/time';
import { Avatar, Card, colors, fonts, space, Text } from '@/ui';

/** Conversations with athletes, the latest first (decision D). */
export default function Inbox() {
  const threads = useThreads();
  return (
    <CoachScreen title="Messages" refreshing={threads.isRefetching} onRefresh={() => threads.refetch()}>
      {threads.data ? (
        threads.data.length ? (
          <Card padded={false}>
            {threads.data.map((t, i) => (
              <Pressable
                key={t.athlete.id}
                accessibilityRole="link"
                accessibilityLabel={`${t.athlete.name}${t.unread ? `, ${t.unread} unread` : ''}`}
                onPress={() => router.push({ pathname: '/athletes/[id]', params: { id: t.athlete.id, tab: 'messages' } })}
                style={[styles.row, i > 0 && styles.rule]}
              >
                <Avatar name={t.athlete.name} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.spread}>
                    <Text variant="small" style={[styles.name, t.unread ? { color: colors.ink } : null]} numberOfLines={1}>
                      {t.athlete.name}
                    </Text>
                    <Text variant="tiny" tone="faint">
                      {agoFrom(t.last_at)}
                    </Text>
                  </View>
                  <Text variant="tiny" tone={t.unread ? 'ink' : 'muted'} numberOfLines={1}>
                    {t.last_from === 'coach' ? 'You: ' : ''}
                    {t.last_body}
                  </Text>
                </View>
                {t.unread ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{t.unread}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </Card>
        ) : (
          <Text variant="small" tone="muted">
            No messages yet. Athletes can message you from their app.
          </Text>
        )
      ) : (
        <Loading error={threads.error} retry={() => threads.refetch()} />
      )}
    </CoachScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m },
  rule: { borderTopWidth: 1, borderTopColor: colors.line2 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  name: { fontFamily: fonts.bold, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 11, fontFamily: fonts.bold },
});
