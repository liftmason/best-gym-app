/** TanStack Query's cache for server reads. The API's 4xx answers are final: no retries. */
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './errors';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
      },
    },
  });
}
