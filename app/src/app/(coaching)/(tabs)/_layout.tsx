import { Feather } from '@expo/vector-icons';
import { Tabs, type BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMe } from '@/auth/me';
import { WIDE } from '@/coaching/layout';
import { useDashboard } from '@/coaching/queries';
import { Avatar, colors, fonts, Text } from '@/ui';

const TABS: Record<string, { label: string; wide: string; icon: keyof typeof Feather.glyphMap }> = {
  dashboard: { label: 'Today', wide: 'Dashboard', icon: 'home' },
  'athletes/index': { label: 'Athletes', wide: 'Athletes', icon: 'users' },
  inbox: { label: 'Messages', wide: 'Messages', icon: 'message-circle' },
  more: { label: 'More', wide: 'Account', icon: 'menu' },
};

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
    </View>
  );
}

/** A bottom bar on a phone; the mockup's sidebar (.snav) on a wide screen. */
function Bar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const wide = useWindowDimensions().width >= WIDE;
  const me = useMe();
  const dashboard = useDashboard();
  const counts: Record<string, number> = { dashboard: dashboard.data?.unread ?? 0 };
  const current = state.routes[state.index]?.name;
  const items = state.routes.filter((r) => TABS[r.name]);

  const item = (route: (typeof state.routes)[number]) => {
    const tab = TABS[route.name];
    // An athlete's page belongs to Athletes.
    const active = current === route.name || (route.name === 'athletes/index' && current === 'athletes/[id]');
    const colour = active ? colors.brand : wide ? colors.ink3 : colors.ink4;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={wide ? tab.wide : tab.label}
        onPress={() => navigation.navigate(route.name)}
        style={[wide ? styles.side : styles.tab, wide && active && styles.sideOn]}
      >
        <View>
          <Feather name={tab.icon} size={wide ? 18 : 20} color={colour} />
          {!wide ? <Badge count={counts[route.name] ?? 0} /> : null}
        </View>
        <Text style={[wide ? styles.sideLabel : styles.label, { color: colour }]}>{wide ? tab.wide : tab.label}</Text>
        {wide && counts[route.name] ? (
          <View style={[styles.badge, styles.badgeInline]}>
            <Text style={styles.badgeText}>{counts[route.name]}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  if (wide) {
    return (
      <View style={[styles.sidebar, { paddingTop: 18 + insets.top }]}>
        <View style={styles.logo}>
          <View style={styles.mark}>
            <Text style={{ color: colors.white, fontFamily: fonts.bold, fontSize: 12 }}>GT</Text>
          </View>
          <Text variant="h4">GymTrainer</Text>
        </View>
        <View style={{ gap: 2 }}>{items.map(item)}</View>
        <View style={styles.foot}>
          <Avatar name={me.data?.name ?? ''} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="small" style={{ fontFamily: fonts.semibold }} numberOfLines={1}>
              {me.data?.name}
            </Text>
            <Text variant="tiny" tone="muted" numberOfLines={1}>
              {me.data?.coach?.gym.name}
            </Text>
          </View>
        </View>
      </View>
    );
  }
  return <View style={[styles.bar, { paddingBottom: 10 + insets.bottom }]}>{items.map(item)}</View>;
}

export default function CoachingTabs() {
  const wide = useWindowDimensions().width >= WIDE;
  return (
    <Tabs
      tabBar={(props) => <Bar {...props} />}
      screenOptions={{ headerShown: false, tabBarPosition: wide ? 'left' : 'bottom', sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="athletes/index" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="more" />
      <Tabs.Screen name="athletes/[id]" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  label: { fontSize: 10, fontFamily: fonts.semibold },
  sidebar: { width: 232, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.line, paddingHorizontal: 12, gap: 18 },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 },
  mark: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  side: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  sideOn: { backgroundColor: colors.brandLight },
  sideLabel: { fontSize: 14, fontFamily: fonts.semibold, flex: 1 },
  foot: { marginTop: 'auto', marginBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 },
  badge: { position: 'absolute', top: -5, right: -9, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.bad, alignItems: 'center', justifyContent: 'center' },
  badgeInline: { position: 'relative', top: 0, right: 0 },
  badgeText: { color: colors.white, fontSize: 9.5, fontFamily: fonts.bold },
});
