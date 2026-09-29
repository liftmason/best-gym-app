/** "Needs your attention" (the mockup's #attnFeed; backend dashboard/alerts.py): newest first, read ones faded. */
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, ok } from '@/api';
import { Button, Card, colors, fonts, radius, space, Text } from '@/ui';

import { look } from './kinds';
import { keys, useFeed } from './queries';
import { agoFrom } from './time';

export function AttentionFeed() {
  const feed = useFeed();
  const queryClient = useQueryClient();
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.feed }), queryClient.invalidateQueries({ queryKey: keys.dashboard })]);

  async function read(id: string) {
    await ok(api.client.POST('/api/v1/feed/{notification_id}/read', { params: { path: { notification_id: id } } })).catch(() => {});
    await refresh();
  }

  return (
    <Card style={{ gap: space.s }}>
      <View style={styles.spread}>
        <Text variant="h4">Needs your attention</Text>
        {items.some((i) => i.read) ? (
          <Button
            title="Clear read"
            size="sm"
            variant="soft"
            onPress={async () => {
              await ok(api.client.POST('/api/v1/feed/clear-read')).catch(() => {});
              await refresh();
            }}
          />
        ) : null}
      </View>
      {feed.isPending ? (
        <Text variant="small" tone="muted">
          Loading…
        </Text>
      ) : items.length ? (
        items.map((item) => {
          const k = look(item.kind);
          return (
            <View key={item.id} style={[styles.row, item.read && styles.read]}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${k.label}: ${item.athlete?.name ?? ''}. ${item.text}`}
                onPress={async () => {
                  if (!item.read) void read(item.id);
                  router.push(item.link as Href);
                }}
                style={styles.item}
              >
                <View style={[styles.icon, { backgroundColor: k.tint }]}>
                  <Feather name={k.icon} size={16} color={k.colour} />
                </View>
                <View style={styles.text}>
                  <Text variant="small" style={styles.bold} numberOfLines={1}>
                    {item.athlete?.name}
                  </Text>
                  <Text variant="small" tone="muted" numberOfLines={2}>
                    {item.text}
                  </Text>
                </View>
                <Text variant="tiny" tone="faint">
                  {agoFrom(item.created_at)}
                </Text>
              </Pressable>
              {!item.read ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Mark as read: ${item.text}`} onPress={() => read(item.id)} style={styles.done} hitSlop={6}>
                  <Feather name="check" size={16} color={colors.ink3} />
                </Pressable>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text variant="small" tone="muted">
          All caught up. Nothing needs your attention.
        </Text>
      )}
      {feed.hasNextPage ? <Button title="Show more" variant="ghost" size="sm" busy={feed.isFetchingNextPage} onPress={() => feed.fetchNextPage()} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  read: { opacity: 0.55 },
  item: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.m, padding: space.s, borderRadius: radius.m },
  icon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  bold: { fontFamily: fonts.bold },
  done: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
