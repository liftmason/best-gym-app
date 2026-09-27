import { Feather } from '@expo/vector-icons';
import { Tabs, type BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, Text } from '@/ui';

const TABS: Record<string, { label: string; icon: keyof typeof Feather.glyphMap }> = {
  home: { label: 'Week', icon: 'calendar' },
  progress: { label: 'Progress', icon: 'trending-up' },
  messages: { label: 'Coach', icon: 'message-circle' },
  profile: { label: 'Profile', icon: 'user' },
};

/** The mockup's .app-tabbar: four tabs, the active one in brand blue. */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: 10 + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const active = state.index === index;
        const colour = active ? colors.brand : colors.ink4;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!active && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.tab}
          >
            <Feather name={tab.icon} size={20} color={colour} />
            <Text style={[styles.label, { color: colour }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TrainingTabs() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="progress" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  label: { fontSize: 10, fontFamily: fonts.semibold },
});
