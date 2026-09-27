/** Who's signed in (GET /me), cached for the session. */
import { useQuery } from '@tanstack/react-query';

import { api, ok } from '@/api';

export const ME = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME, queryFn: () => ok(api.client.GET('/api/v1/me')) });
}
