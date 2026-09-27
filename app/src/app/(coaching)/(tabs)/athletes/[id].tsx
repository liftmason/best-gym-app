import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api, ApiError, ok } from '@/api';
import { useMe } from '@/auth/me';
import { AthleteHeader } from '@/coaching/athlete/header';
import { Messages } from '@/coaching/athlete/messages';
import { Metrics } from '@/coaching/athlete/metrics';
import { Sessions } from '@/coaching/athlete/sessions';
import { Overview, WeekGlance } from '@/coaching/athlete/overview';
import { CoachScreen, Loading } from '@/coaching/layout';
import { useAthlete, useOverview } from '@/coaching/queries';
import { dayMonth } from '@/training/format';
import { Button, Card, colors, fonts, Sheet, space, Text } from '@/ui';
import { confirm } from '@/ui/confirm';

const TABS = [
  ['overview', 'Overview'],
  ['program', 'Program'],
  ['sessions', 'Sessions'],
  ['metrics', 'Metrics'],
  ['messages', 'Messages'],
] as const;
type Tab = (typeof TABS)[number][0];

function ProgramGlance({ id, name }: { id: string; name: string }) {
  const overview = useOverview(id, null);
  return (
    <View style={{ gap: space.m }}>
      <Card style={{ gap: space.s }}>
        <Text variant="h4">This week</Text>
        {overview.data?.week.length ? <WeekGlance days={overview.data.week} /> : <Text variant="small" tone="muted">No program this week.</Text>}
      </Card>
      <Card style={{ gap: space.s }}>
        <Text variant="h4">Programming is on a computer for now</Text>
        <Text variant="small" tone="muted">
          Open GymTrainer on the web to build and publish {name}&apos;s weeks. Programming on a phone is planned.
        </Text>
      </Card>
    </View>
  );
}

/** One athlete (the mockup's #panel-client): header, tabs, and what's in each. */
export default function AthleteScreen() {
  const { id, tab: wanted, focus, range } = useLocalSearchParams<{ id: string; tab?: string; focus?: string; range?: string }>();
  const tab: Tab = (TABS.find(([t]) => t === wanted)?.[0] ?? 'overview') as Tab;
  const athlete = useAthlete(id);
  const me = useMe();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const unit = me.data?.coach?.gym.units ?? 'kg';
  const first = athlete.data?.athlete.name.split(/\s+/)[0] ?? '';

  async function archive() {
    setMenu(false);
    const name = athlete.data?.athlete.name ?? 'this athlete';
    if (!(await confirm(`Archive ${name}?`, 'They keep their history and account, and can join a coach again through an invite.', 'Archive'))) return;
    try {
      await ok(api.client.POST('/api/v1/athletes/{athlete_id}/archive', { params: { path: { athlete_id: id } } }));
      await queryClient.invalidateQueries({ queryKey: ['coach'] });
      router.replace('/athletes');
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Couldn't archive. Try again.");
    }
  }

  return (
    <CoachScreen
      title={athlete.data?.athlete.name ?? 'Athlete'}
      subtitle={
        athlete.data
          ? [athlete.data.weight_class, athlete.data.competition_name ? `next comp: ${athlete.data.competition_name}${athlete.data.competition_date ? ` — ${dayMonth(athlete.data.competition_date)}` : ''}` : 'no competition scheduled']
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      actions={
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to athletes" onPress={() => (router.canGoBack() ? router.back() : router.replace('/athletes'))} style={styles.icon}>
            <Feather name="arrow-left" size={18} color={colors.ink2} />
          </Pressable>
          <Button title="Message" size="sm" variant="soft" onPress={() => router.setParams({ tab: 'messages' })} />
          <Pressable accessibilityRole="button" accessibilityLabel="More actions" onPress={() => setMenu(true)} style={styles.icon}>
            <Feather name="more-horizontal" size={18} color={colors.ink2} />
          </Pressable>
        </View>
      }
    >
      {athlete.data ? (
        <>
          <AthleteHeader athlete={athlete.data} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map(([t, label]) => (
              <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => router.setParams({ tab: t, focus: undefined })} style={[styles.tab, tab === t && styles.tabOn]}>
                <Text style={[styles.tabText, tab === t && { color: colors.brand }]}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {problem ? (
            <Text variant="small" tone="bad" accessibilityRole="alert">
              {problem}
            </Text>
          ) : null}
          {tab === 'overview' ? <Overview id={id} unit={unit} /> : null}
          {tab === 'program' ? <ProgramGlance id={id} name={first} /> : null}
          {tab === 'sessions' ? <Sessions key={`${id}-${focus ?? ''}`} id={id} first={first} focus={focus} range={range} /> : null}
          {tab === 'metrics' ? <Metrics id={id} first={first} unit={unit} maxUpdates={athlete.data.max_updates} focus={focus} /> : null}
          {tab === 'messages' ? <Messages id={id} first={first} /> : null}
        </>
      ) : (
        <Loading error={athlete.error} retry={() => athlete.refetch()} />
      )}
      <Sheet open={menu} onClose={() => setMenu(false)} title={athlete.data?.athlete.name ?? ''}>
        <Button title="Archive athlete" variant="danger" block onPress={archive} />
      </Sheet>
    </CoachScreen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  tabs: { gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.brand },
  tabText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink3 },
});
