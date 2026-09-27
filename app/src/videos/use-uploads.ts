/** The videos waiting to upload for one exercise, live. */
import { useEffect, useState } from 'react';

import { watch } from '@/db/live';
import { useSync } from '@/sync/provider';

import type { Upload } from './queue';

export function useUploads(sessionExerciseId: string): Upload[] {
  const { database, videos } = useSync();
  const [uploads, setUploads] = useState<Upload[]>([]);
  useEffect(() => {
    let alive = true;
    const read = () => videos.all().then((all) => alive && setUploads(all.filter((u) => u.session_exercise_id === sessionExerciseId)));
    read();
    const stop = watch(database, ['uploads'], read);
    return () => {
      alive = false;
      stop();
    };
  }, [database, videos, sessionExerciseId]);
  return uploads;
}
