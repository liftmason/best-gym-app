import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { useMe } from '@/auth/me';
import { CoachScreen } from '@/coaching/layout';
import { ExerciseLibrary } from '@/coaching/library/exercises';
import { TemplateList } from '@/coaching/library/lists';
import { QuestionsEditor } from '@/coaching/library/questions';
import { colors, fonts, Text } from '@/ui';

const TABS = [
  ['templates', 'Templates'],
  ['weeks', 'Weeks'],
  ['sessions', 'Sessions'],
  ['exercises', 'Exercises'],
  ['questions', 'Check-in questions'],
] as const;
type Tab = (typeof TABS)[number][0];

/** Programming (the mockup's #panel-templates): the library the coach builds once and applies. */
export default function Programming() {
  const { tab: wanted } = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = (TABS.find(([t]) => t === wanted)?.[0] ?? 'templates') as Tab;
  const entitlements = useMe().data?.coach?.entitlements;
  const readOnly = entitlements ? !entitlements.programming : false;
  return (
    <CoachScreen
      title="Programming"
      subtitle="Build the system once — sessions → weeks → templates, plus the exercise library and default check-in questions — then apply it to an athlete and review the result on their board before it goes live."
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map(([t, label]) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => router.setParams({ tab: t })} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t && { color: colors.brand }]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {readOnly ? (
        <Text variant="small" tone="warn">
          Your plan has lapsed, so programming is read-only.
        </Text>
      ) : null}
      {tab === 'templates' ? <TemplateList kind="program" readOnly={readOnly} /> : null}
      {tab === 'weeks' ? <TemplateList kind="week" readOnly={readOnly} /> : null}
      {tab === 'sessions' ? <TemplateList kind="session" readOnly={readOnly} /> : null}
      {tab === 'exercises' ? <ExerciseLibrary readOnly={readOnly} /> : null}
      {tab === 'questions' ? <QuestionsEditor athlete={null} /> : null}
    </CoachScreen>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.brand },
  tabText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink3 },
});
