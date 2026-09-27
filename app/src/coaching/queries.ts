/** The coach's reads, cached with TanStack Query (the API is the source; nothing is stored on the device). */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api, ok } from '@/api';

export const keys = {
  dashboard: ['coach', 'dashboard'] as const,
  feed: ['coach', 'feed'] as const,
  roster: (sort: string, q: string) => ['coach', 'roster', sort, q] as const,
  threads: ['coach', 'threads'] as const,
  athlete: (id: string) => ['coach', 'athlete', id] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: () => ok(api.client.GET('/api/v1/dashboard')),
    refetchInterval: 60_000,
  });
}

export function useFeed() {
  return useInfiniteQuery({
    queryKey: keys.feed,
    queryFn: ({ pageParam }) => ok(api.client.GET('/api/v1/feed', { params: { query: { before: pageParam, limit: 20 } } })),
    initialPageParam: '',
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 30_000,
  });
}

export function useRoster(sort: string, q: string) {
  return useQuery({
    queryKey: keys.roster(sort, q),
    queryFn: () => ok(api.client.GET('/api/v1/roster', { params: { query: { sort, q } } })),
  });
}

export function useInvites() {
  return useQuery({ queryKey: ['coach', 'invites'], queryFn: () => ok(api.client.GET('/api/v1/invites')) });
}

export function useInviteTemplates() {
  return useQuery({ queryKey: ['coach', 'invite-templates'], queryFn: () => ok(api.client.GET('/api/v1/invites/templates')) });
}

export function useAthlete(id: string) {
  return useQuery({
    queryKey: [...keys.athlete(id), 'header'],
    queryFn: () => ok(api.client.GET('/api/v1/athletes/{athlete_id}', { params: { path: { athlete_id: id } } })),
  });
}

export function useOverview(id: string, lift: string | null) {
  return useQuery({
    queryKey: [...keys.athlete(id), 'overview', lift],
    queryFn: () =>
      ok(api.client.GET('/api/v1/athletes/{athlete_id}/overview', { params: { path: { athlete_id: id }, query: lift ? { lift } : {} } })),
  });
}

export function useThreads() {
  return useQuery({ queryKey: keys.threads, queryFn: () => ok(api.client.GET('/api/v1/threads')), refetchInterval: 30_000 });
}
