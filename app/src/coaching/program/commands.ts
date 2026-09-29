/**
 * Every change to a program is a command (docs/EXPO_MIGRATION.md, "Ready for phone programming
 * later"): buttons, menus, drag and drop and Ctrl+Z all call these. Each one asks the API,
 * refreshes the athlete's program, and says what happened in a toast, with the old coach
 * screens' wording. A refusal (a logged week that can't move, a lapsed plan…) shows the
 * API's message and returns undefined; success returns the answer, or null when it has no body.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api, ApiError, ok } from '@/api';
import { dayMonth, shortDay } from '@/training/format';
import { useToast } from '@/ui';

import { keys as coachKeys } from '../queries';
import type { Choices, Dose, Item, PlannedSession, Week, WeekSummary, WeekTypeRef } from './queries';

type Exercise = { id: string; name: string };

export function useProgramCommands(id: string, first: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMemo(() => {
    const athlete = { athlete_id: id };
    const refresh = () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: coachKeys.athlete(id) }),
        queryClient.invalidateQueries({ queryKey: coachKeys.dashboard }),
      ]);

    /** Runs a change: on success refresh and toast; on a refusal toast the reason. */
    async function run<T>(change: () => Promise<T>, said?: (result: T) => string | null): Promise<T | undefined> {
      try {
        const result = await change();
        await refresh();
        const message = said?.(result);
        if (message) toast(message, 'good');
        // A 204 has no body: success is null, so undefined always means refused.
        return result === undefined ? (null as T) : result;
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Something went wrong. Try again.', 'bad');
        return undefined;
      }
    }

    return {
      refresh,

      start: (program: { name: string; first_day: string; weeks: number; week_type_id: string }, hadOne: boolean) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/program', { params: { path: athlete }, body: program })),
          () => `Started “${program.name}” with ${program.weeks} week${program.weeks === 1 ? '' : 's'}.${hadOne ? ' The previous program was ended and kept.' : ''}`,
        ),

      setProgramNote: (note: string) =>
        run(() => ok(api.client.PUT('/api/v1/athletes/{athlete_id}/program/note', { params: { path: athlete }, body: { note } })), () => 'Program note saved'),

      addWeek: () =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/program/weeks', { params: { path: athlete } })),
          (week) => `${week.label} added at the end (${dayMonth(week.start_date)})`,
        ),

      duplicateWeek: (week: WeekSummary) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/weeks/{week_id}/duplicate', { params: { path: { ...athlete, week_id: week.id } } })),
          (copy) => `Duplicated into ${copy.label}. Later weeks moved back a week. It isn't published yet.`,
        ),

      deleteWeek: (week: WeekSummary) =>
        run(
          () => ok(api.client.DELETE('/api/v1/athletes/{athlete_id}/weeks/{week_id}', { params: { path: { ...athlete, week_id: week.id } } })),
          () => `Deleted ${week.label}. Later weeks moved up a week`,
        ),

      clearWeek: (week: WeekSummary) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/weeks/{week_id}/clear', { params: { path: { ...athlete, week_id: week.id } } })),
          (cleared) => (cleared.kept ? `Week cleared. ${cleared.kept} completed day${cleared.kept === 1 ? '' : 's'} kept` : 'Week cleared'),
        ),

      setWeekType: (week: WeekSummary, type: WeekTypeRef) =>
        run(
          () => ok(api.client.PATCH('/api/v1/athletes/{athlete_id}/weeks/{week_id}', { params: { path: { ...athlete, week_id: week.id } }, body: { week_type_id: type.id } })),
          () => `${week.label} is now ${type.name}`,
        ),

      setFocusNote: (week: WeekSummary, focus_note: string) =>
        run(
          () => ok(api.client.PATCH('/api/v1/athletes/{athlete_id}/weeks/{week_id}', { params: { path: { ...athlete, week_id: week.id } }, body: { focus_note } })),
          () => 'Focus note saved',
        ),

      publish: (week: WeekSummary, published: boolean) =>
        run(
          () => ok(api.client.PATCH('/api/v1/athletes/{athlete_id}/weeks/{week_id}', { params: { path: { ...athlete, week_id: week.id } }, body: { published } })),
          () =>
            published
              ? `${week.label} published. ${first} sees it now, and later edits go live straight away`
              : `${week.label} unpublished. ${first} no longer sees it`,
        ),

      undo: (week: Week) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/weeks/{week_id}/undo', { params: { path: { ...athlete, week_id: week.id } } })),
          (done) => (done.undone ? `Undone: ${done.undone}` : "Nothing to undo in this week. Adding, duplicating or deleting weeks can't be undone"),
        ),

      addSession: (dayId: string) =>
        run(() => ok(api.client.POST('/api/v1/athletes/{athlete_id}/days/{day_id}/sessions', { params: { path: { ...athlete, day_id: dayId } } }))),

      renameSession: (session: PlannedSession, name: string) =>
        run(() => ok(api.client.PATCH('/api/v1/athletes/{athlete_id}/planned-sessions/{session_id}', { params: { path: { ...athlete, session_id: session.id } }, body: { name } }))),

      removeSession: (session: PlannedSession) =>
        run(
          () => ok(api.client.DELETE('/api/v1/athletes/{athlete_id}/planned-sessions/{session_id}', { params: { path: { ...athlete, session_id: session.id } } })),
          () => `Removed ${session.name || 'the session'}`,
        ),

      /** Adds to the day (its first session, or `sessionId`), at the end or at `index`. */
      add: (exercise: Exercise, day: { id: string; date: string }, sessionId?: string, index?: number) =>
        run(
          () =>
            ok(
              api.client.POST('/api/v1/athletes/{athlete_id}/days/{day_id}/prescriptions', {
                params: { path: { ...athlete, day_id: day.id } },
                body: { exercise_id: exercise.id, session_id: sessionId ?? null, index: index ?? null },
              }),
            ),
          () => `${exercise.name} → ${dayMonth(day.date)}`,
        ),

      /** Saves a dose. It throws the API's error (with its field messages) for the editor to show. */
      edit: async (rx: { id: string; exercise: Exercise }, dose: Dose) => {
        const saved = await ok(api.client.PUT('/api/v1/athletes/{athlete_id}/prescriptions/{rx_id}', { params: { path: { ...athlete, rx_id: rx.id } }, body: dose }));
        await refresh();
        toast(`${rx.exercise.name} updated`, 'good');
        return saved;
      },

      remove: (item: Item, date: string) =>
        run(
          () => ok(api.client.DELETE('/api/v1/athletes/{athlete_id}/prescriptions/{rx_id}', { params: { path: { ...athlete, rx_id: item.id } } })),
          () => `Removed ${item.exercise.name} from ${shortDay(date)}`,
        ),

      /** Into a session at `index`, or onto a day (its first session, or a new one on a rest day). */
      move: (item: Item, to: { sessionId: string } | { dayId: string }, index: number) =>
        run(() =>
          ok(
            api.client.POST('/api/v1/athletes/{athlete_id}/prescriptions/{rx_id}/move', {
              params: { path: { ...athlete, rx_id: item.id } },
              body: 'sessionId' in to ? { session_id: to.sessionId, index } : { day_id: to.dayId, index },
            }),
          ),
        ),

      swap: (rx: { id: string; exercise: Exercise }, to: Exercise) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/prescriptions/{rx_id}/swap', { params: { path: { ...athlete, rx_id: rx.id } }, body: { exercise_id: to.id } })),
          (swapped) => `Swapped ${rx.exercise.name} for ${to.name}, kept ${swapped.summary}`,
        ),

      saveWeek: (week: WeekSummary, name: string, description: string) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/weeks/{week_id}/save', { params: { path: { ...athlete, week_id: week.id } }, body: { name, description } })),
          (card) => `“${card.name}” saved. Find it under Programming › Weeks`,
        ),

      saveSession: (session: PlannedSession, name: string, description: string) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/planned-sessions/{session_id}/save', { params: { path: { ...athlete, session_id: session.id } }, body: { name, description } })),
          (card) => `“${card.name}” saved. Find it under Programming › Sessions`,
        ),

      saveProgram: (name: string, description: string) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/program/save', { params: { path: athlete }, body: { name, description } })),
          (card) => `Saved as “${card.name}”. Open it under Programming › Templates to refine`,
        ),

      /** Writes what the preview showed. */
      apply: (choices: Choices, name: string, firstLabel: string) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/apply', { params: { path: athlete }, body: choices })),
          (applied) =>
            `“${name}” applied from ${firstLabel}, ${choices.publish ? 'published' : `unpublished (review, then publish to ${first})`}` +
            (applied.habits_added ? ` · ${applied.habits_added} habit${applied.habits_added === 1 ? '' : 's'} prescribed` : ''),
        ),

      prescribeHabit: (habit: { name: string; emoji: string; cadence: string; note: string }) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/habits', { params: { path: athlete }, body: habit })),
          () => `Habit prescribed. ${first} sees it in their app today`,
        ),

      stopHabit: (habit: { id: string; name: string }) =>
        run(
          () => ok(api.client.POST('/api/v1/athletes/{athlete_id}/habits/{habit_id}/archive', { params: { path: { ...athlete, habit_id: habit.id } } })),
          () => `Stopped prescribing “${habit.name}” (its history is kept)`,
        ),
    };
  }, [id, first, queryClient, toast]);
}

export type ProgramCommands = ReturnType<typeof useProgramCommands>;
