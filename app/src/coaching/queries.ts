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
