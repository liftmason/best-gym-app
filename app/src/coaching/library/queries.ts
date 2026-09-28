/** Reads for Programming (templates, the exercise library, check-in questions) and Settings. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api, ok } from '@/api';
import type { components } from '@/api/schema';

export type TemplateCard = components['schemas']['Card'];
export type Editor = components['schemas']['Editor'];
export type TemplateWeek = components['schemas']['TemplateWeek'];
export type TemplateSession = components['schemas']['TemplateSession'];
export type Slot = components['schemas']['Slot'];
export type SlotDetail = components['schemas']['SlotOut'];
export type Exercise = components['schemas']['ExerciseOut'];
export type ExerciseInput = components['schemas']['ExerciseIn'];
export type Impact = components['schemas']['Impact'];
export type Question = components['schemas']['QuestionOut'];
export type Settings = components['schemas']['SettingsOut'];
export type WeekType = components['schemas']['WeekTypeOut'];
export type Kind = 'program' | 'week' | 'session';

export const libraryKeys = {
  all: ['coach', 'library'] as const,
  templates: (kind: Kind) => ['coach', 'library', 'templates', kind] as const,
  template: (id: string) => ['coach', 'library', 'template', id] as const,
  slot: (template: string, slot: string) => ['coach', 'library', 'template', template, 'slot', slot] as const,
  saved: (template: string, kind: string) => ['coach', 'library', 'template', template, 'saved', kind] as const,
  exercises: (q: string, tags: string[], archived: boolean) => ['coach', 'library', 'exercises', q, tags, archived] as const,
  categories: ['coach', 'library', 'categories'] as const,
  tags: ['coach', 'tags'] as const,
  questions: (athlete: string | null) => ['coach', 'questions', athlete ?? 'defaults'] as const,
  settings: ['coach', 'settings'] as const,
};

export function useTemplates(kind: Kind) {
  return useQuery({ queryKey: libraryKeys.templates(kind), queryFn: () => ok(api.client.GET('/api/v1/templates', { params: { query: { kind } } })) });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: libraryKeys.template(id),
    queryFn: () => ok(api.client.GET('/api/v1/templates/{template_id}', { params: { path: { template_id: id } } })),
  });
}

export function useSlot(template: string, slot: string | null) {
  return useQuery({
    queryKey: libraryKeys.slot(template, slot ?? ''),
    queryFn: () => ok(api.client.GET('/api/v1/templates/{template_id}/slots/{slot_id}', { params: { path: { template_id: template, slot_id: slot! } } })),
    enabled: Boolean(slot),
  });
}

export function useSaved(template: string, kind: 'week' | 'session' | null) {
  return useQuery({
    queryKey: libraryKeys.saved(template, kind ?? ''),
    queryFn: () => ok(api.client.GET('/api/v1/templates/{template_id}/saved', { params: { path: { template_id: template }, query: { kind: kind! } } })),
    enabled: Boolean(kind),
  });
}

export function useExercises(q = '', tags: string[] = [], archived = false) {
  return useQuery({
    queryKey: libraryKeys.exercises(q, tags, archived),
    queryFn: () => ok(api.client.GET('/api/v1/exercises', { params: { query: { q, tags, archived } } })),
    placeholderData: keepPreviousData,
  });
}

export function useCategories() {
  return useQuery({ queryKey: libraryKeys.categories, queryFn: () => ok(api.client.GET('/api/v1/categories')) });
}

export function useQuestions(athlete: string | null) {
  return useQuery({
    queryKey: libraryKeys.questions(athlete),
    queryFn: () =>
      athlete
        ? ok(api.client.GET('/api/v1/athletes/{athlete_id}/questions', { params: { path: { athlete_id: athlete } } }))
        : ok(api.client.GET('/api/v1/default-questions')),
  });
}

export function useSettings() {
  return useQuery({ queryKey: libraryKeys.settings, queryFn: () => ok(api.client.GET('/api/v1/settings')) });
}

export function useWeekTypes() {
  return useQuery({ queryKey: ['coach', 'week-types'], queryFn: () => ok(api.client.GET('/api/v1/week-types')) });
}

export function useTracked() {
  return useQuery({ queryKey: ['coach', 'tracked'], queryFn: () => ok(api.client.GET('/api/v1/tracked-lifts')) });
}

export function useTrackable() {
  return useQuery({ queryKey: ['coach', 'trackable'], queryFn: () => ok(api.client.GET('/api/v1/trackable-lifts')) });
}

export function usePlans(enabled: boolean) {
  return useQuery({ queryKey: ['coach', 'plans'], queryFn: () => ok(api.client.GET('/api/v1/billing/plans')), enabled });
}

export function useStarterPacks() {
  return useQuery({ queryKey: ['starter-packs'], queryFn: () => ok(api.client.GET('/api/v1/auth/signup/starters')) });
}
