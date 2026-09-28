/**
 * Running a coach's change: ask the API, refresh what it touched, and say what happened in a
 * toast (or the API's reason when it refuses). The program board's commands follow the same
 * pattern (program/commands.ts); the library, questions and settings screens use this.
 * It returns the answer (null for one with no body), or undefined when the change was refused.
 */
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback } from 'react';

import { ApiError } from '@/api';
import { useToast } from '@/ui';

export function useChange() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useCallback(
    async <T>(change: () => Promise<T>, { said, refresh = [['coach']] }: { said?: string | ((result: T) => string | null); refresh?: QueryKey[] } = {}): Promise<T | undefined> => {
      try {
        const result = await change();
        await Promise.all(refresh.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
        const message = typeof said === 'function' ? said(result) : said;
        if (message) toast(message, 'good');
        // A 204 has no body: success is null, so undefined always means refused.
        return result === undefined ? (null as T) : result;
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Something went wrong. Try again.', 'bad');
        return undefined;
      }
    },
    [queryClient, toast],
  );
}
