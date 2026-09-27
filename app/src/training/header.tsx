/** The top of the athlete's app (the mockup's .app-head): who, which block and week, sync, messages. */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSync } from '@/sync/provider';
import { SyncPill } from '@/sync/status';
import { Avatar, colors, space, Text } from '@/ui';

export function TrainingHeader({ subtitle }: { subtitle?: string }) {
  const { profile } = useSync();
  const first = profile.name.trim().split(/\s+/)[0] ?? '';
  return (
    <View style={styles.head}>
      <Avatar name={profile.name} />
      <View style={styles.hi}>
        <Text variant="h4">{first ? `Hi, ${first}` : 'Hi'}</Text>
        <Text variant="tiny" tone="muted" numberOfLines={1}>
          {subtitle ?? profile.gymName ?? ''}
        </Text>
      </View>
      <SyncPill />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Messages"
        onPress={() => router.navigate('/messages')}
        style={styles.icon}
        hitSlop={8}
      >
        <Feather name="message-circle" size={20} color={colors.ink2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: space.l,
    paddingBottom: space.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
    backgroundColor: colors.surface,
  },
  hi: { flex: 1, minWidth: 0 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
});
