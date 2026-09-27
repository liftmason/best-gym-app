import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { weekEnd, weekView, type Card as SessionCardView } from '@/domain/week';
import { Refused } from '@/sync/actions';
import { useSync } from '@/sync/provider';
import { SyncNotices } from '@/sync/status';
import { range, shortDay } from '@/training/format';
import { TrainingHeader } from '@/training/header';
import { Habits } from '@/training/home/habits';
import { DayCard, RestCard } from '@/training/home/day-card';
import { Notes } from '@/training/home/notes';
import { PausedCard } from '@/training/home/paused';
import { WeekHeader } from '@/training/home/week-header';
import { startSession } from '@/training/start';
import { useTraining } from '@/training/use-training';
import { colors, space, Text, WeekStrip } from '@/ui';

/** The athlete's week (the mockup's #m-home): the strip, the day's sessions, habits and notes. */
export default function Home() {
  const world = useTraining();
  const { engine, profile } = useSync();
  const [wanted, setWanted] = useState<{ week: string | null; day: string | null }>({ week: null, day: null });
  const [problem, setProblem] = useState<string | null>(null);

  if (!world) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  const view = weekView(world, wanted.week, wanted.day);
  const { week } = view;
  const weekType = week?.week_type_id ? world.weekType.get(week.week_type_id) : undefined;
  const subtitle = [world.program?.name, view.number && `wk ${view.number}`, profile.gymName].filter(Boolean).join(' · ');
  const selected = view.strip?.find((d) => d.selected);

  async function open(card: SessionCardView) {
    setProblem(null);
    try {
      const logId = await startSession(engine, world!, card.session.id);
      router.push({ pathname: '/session/[log]', params: { log: logId } });
    } catch (error) {
      setProblem(error instanceof Refused ? error.message : "Couldn't start the session. Try again.");
    }
  }

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <TrainingHeader subtitle={subtitle} />
      <SyncNotices />
      <ScrollView contentContainerStyle={styles.body}>
        {view.paused.map((log) => (
          <PausedCard key={log.id} log={log} onResume={() => router.push({ pathname: '/session/[log]', params: { log: log.id } })} />
        ))}

        {!world.program ? (
          <View style={styles.empty}>
            <Text variant="h4">No program yet</Text>
            <Text variant="small" tone="muted" style={styles.centred}>
              {profile.coachName ?? 'Your coach'} is putting your training together. Your week shows up here as soon as it&apos;s
              published.
            </Text>
          </View>
        ) : !week ? (
          <View style={styles.empty}>
            <Text variant="h4">{world.program.name}</Text>
            <Text variant="small" tone="muted" style={styles.centred}>
              {profile.coachName ?? 'Your coach'} hasn&apos;t published a week of it yet. Check back soon.
            </Text>
          </View>
        ) : (
          <>
            <WeekHeader
              label={`Wk ${view.number} · ${range(week.start_date, weekEnd(week))}`}
              weekType={weekType}
              onPrevious={view.prev_week ? () => setWanted({ week: view.prev_week!.start_date, day: null }) : undefined}
              onNext={view.next_week ? () => setWanted({ week: view.next_week!.start_date, day: null }) : undefined}
            />
            <WeekStrip
              days={view.strip!.map((d) => ({
                date: d.day.date,
                weekday: shortDay(d.day.date),
                state: d.status === 'rest' ? 'rest' : d.status === 'done' ? 'done' : d.status === 'missed' ? 'missed' : 'planned',
                mark: d.status === 'done' ? '✓' : d.status === 'rest' ? '·' : String(d.count),
                today: d.is_today,
                selected: d.selected,
              }))}
              onSelect={(date) => setWanted({ week: week.start_date, day: date })}
            />
            {problem ? (
              <Text variant="small" tone="bad" accessibilityRole="alert">
                {problem}
              </Text>
            ) : null}
            {view.cards?.length ? (
              view.cards.map((card) => (
                <DayCard
                  key={card.session.id}
                  card={card}
                  date={selected!.day.date}
                  isToday={selected!.is_today}
                  weekType={weekType}
                  onOpen={() => open(card)}
                  onReview={() => router.push({ pathname: '/session/[log]', params: { log: card.log!.id, review: '1' } })}
                />
              ))
            ) : selected ? (
              <RestCard date={selected.day.date} isToday={selected.is_today} weekType={weekType} />
            ) : null}
          </>
        )}

        <Habits world={world} />
        <Notes program={world.program} week={week} coachName={profile.coachName} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 18, paddingBottom: space.xxl, gap: space.m },
  empty: { alignItems: 'center', gap: space.s, padding: space.xl, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line },
  centred: { textAlign: 'center' },
});
