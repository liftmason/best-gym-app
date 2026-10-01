/** The frame of the coach's screens: a title bar and a scrolling page, wider on the web. */
import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api';
import { AvoidKeyboard, Button, colors, space, Text } from '@/ui';

/** At this width and wider, the sidebar and the desktop layout (the mockup's). */
export const WIDE = 960;

export function CoachScreen({
  title,
  subtitle,
  actions,
  children,
  refreshing,
  onRefresh,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const wide = useWindowDimensions().width >= WIDE;
  return (
    <SafeAreaView style={styles.page} edges={wide ? [] : ['top']}>
      <View style={[styles.top, wide && styles.topWide]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant={wide ? 'h2' : 'h3'} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="tiny" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions}
      </View>
      <AvoidKeyboard style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.body, wide && styles.bodyWide]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}
        >
          {children}
        </ScrollView>
      </AvoidKeyboard>
    </SafeAreaView>
  );
}

/** Loading, or why it failed (coaching needs a connection), with a retry. */
export function Loading({ error, retry }: { error?: unknown; retry?: () => void }) {
  if (!error) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  const offline = error instanceof ApiError && error.offline;
  return (
    <View style={styles.centre}>
      <Text variant="h4">{offline ? "You're offline" : "Couldn't load this"}</Text>
      <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>
        {offline ? 'Coaching needs a connection. Your athletes can keep training offline.' : error instanceof ApiError ? error.message : 'Try again.'}
      </Text>
      {retry ? <Button title="Try again" variant="ghost" onPress={retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: 18,
    paddingVertical: space.m,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  topWide: { paddingHorizontal: 28, paddingVertical: 18 },
  body: { padding: 18, paddingBottom: space.xxl, gap: space.m },
  bodyWide: { padding: 28, maxWidth: 1240, width: '100%', alignSelf: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s, padding: space.xl },
});
