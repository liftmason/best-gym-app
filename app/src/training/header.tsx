/** The top of the athlete's app (the mockup's .app-head): who, which block and week, sync, reporting a bug, messages. */
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { unread } from '@/domain/messages';
import { useSync } from '@/sync/provider';
import { ReportBugIcon } from '@/support/report-bug';
import { SyncPill } from '@/sync/status';
import { Avatar, colors, fonts, space, Text } from '@/ui';

import { useTraining } from './use-training';

export function TrainingHeader({ subtitle }: { subtitle?: string }) {
  const { profile } = useSync();
  const world = useTraining();
  const waiting = world ? unread(world, profile.userId) : 0;
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
      <ReportBugIcon side="athlete" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={waiting ? `Messages, ${waiting} unread` : 'Messages'}
        onPress={() => router.navigate('/messages')}
        style={styles.icon}
        hitSlop={8}
      >
        <Feather name="message-circle" size={20} color={colors.ink2} />
        {waiting ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{waiting > 9 ? '9+' : waiting}</Text>
          </View>
        ) : null}
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
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.bad,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontSize: 10, fontFamily: fonts.bold },
});
