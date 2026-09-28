/** The program board's reads (TanStack Query): the board, the exercise rail, one prescription, habits. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api, ok } from '@/api';
import type { components } from '@/api/schema';

import { keys as coachKeys } from '../queries';

export type Board = components['schemas']['BoardOut'];
export type Week = components['schemas']['Week'];
export type WeekSummary = components['schemas']['WeekSummary'];
export type Day = components['schemas']['Day'];
export type PlannedSession = components['schemas']['PlannedSession'];
export type Item = components['schemas']['BoardItem'];
export type Dose = components['schemas']['Dose'];
export type Prescription = components['schemas']['PrescriptionOut'];
export type RailExercise = components['schemas']['RailExercise'];
export type WeekTypeRef = components['schemas']['WeekTypeRef'];
export type Habit = components['schemas']['HabitOut'];
export type Preview = components['schemas']['Preview'];
export type Choices = components['schemas']['Choices'];

/** Everything about one athlete's program sits under their key, so one invalidation refreshes it all. */
export const programKeys = {
  all: (id: string) => [...coachKeys.athlete(id), 'program'] as const,
  board: (id: string, week: string | null) => [...coachKeys.athlete(id), 'program', 'board', week] as const,
  rail: (id: string, q: string, tags: string[], sort: string) => [...coachKeys.athlete(id), 'program', 'rail', q, tags, sort] as const,
  prescription: (id: string, rx: string) => [...coachKeys.athlete(id), 'program', 'rx', rx] as const,
  habits: (id: string) => [...coachKeys.athlete(id), 'program', 'habits'] as const,
  sources: (id: string) => [...coachKeys.athlete(id), 'program', 'sources'] as const,
};

const path = (id: string) => ({ path: { athlete_id: id } });

export function useBoard(id: string, week: string | null) {
  return useQuery({
    queryKey: programKeys.board(id, week),
    queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/program', { params: { ...path(id), query: week ? { week_id: week } : {} } })),
    placeholderData: keepPreviousData, // switching weeks keeps the last one on screen until the next arrives
  });
}

export function useRail(id: string, q: string, tags: string[], sort: 'recent' | 'az') {
  return useQuery({
    queryKey: programKeys.rail(id, q, tags, sort),
    queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/rail', { params: { ...path(id), query: { q, tags, sort } } })),
    placeholderData: keepPreviousData,
  });
}

export function useTags() {
  return useQuery({ queryKey: ['coach', 'tags'], queryFn: () => ok(api.client.GET('/api/v1/tags')) });
}

export function usePrescription(id: string, rx: string | null) {
  return useQuery({
    queryKey: programKeys.prescription(id, rx ?? ''),
    queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/prescriptions/{rx_id}', { params: { path: { athlete_id: id, rx_id: rx! } } })),
    enabled: Boolean(rx),
  });
}

export function useHabits(id: string) {
  return useQuery({ queryKey: programKeys.habits(id), queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/habits', { params: path(id) })) });
}

export function useApplySources(id: string) {
  return useQuery({ queryKey: programKeys.sources(id), queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}/apply/sources', { params: path(id) })) });
}
