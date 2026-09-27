/**
 * What training mode needs to know about the athlete, kept on the device so it opens with no
 * connection (S5 decision D): from the latest /me, else the copy saved last time.
 */
import { useEffect, useState } from 'react';

import { ApiError, type components } from '@/api';
import { useMe } from '@/auth/me';
import { getPref, setPref } from '@/auth/prefs';
import type { Unit } from '@/domain/units';
import type { Who } from '@/sync/engine';

export type TrainingProfile = Who & {
  name: string;
  units: Unit;
  weekStart: number;
  coachName: string | null;
  gymName: string | null;
  heightCm: string | null;
  yearsTraining: string | null;
};

const KEY = 'gt.training';

type Me = components['schemas']['MeOut'];

export function profileFrom(me: Me): TrainingProfile | null {
  const a = me.athlete;
  if (!a) return null;
  return {
    athleteId: a.id,
    userId: me.id,
    name: me.name,
    timezone: me.timezone,
    units: a.units === 'lb' ? 'lb' : 'kg',
    weekStart: a.week_start,
    maxUpdates: a.max_updates,
    coachName: a.coach_name ?? null,
    gymName: a.gym_name ?? null,
    heightCm: a.height_cm ?? null,
    yearsTraining: a.years_training ?? null,
  };
}

export async function savedProfile(): Promise<TrainingProfile | null> {
  try {
    const saved = JSON.parse((await getPref(KEY)) ?? 'null');
    return typeof saved?.athleteId === 'string' && typeof saved?.timezone === 'string' ? saved : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: TrainingProfile | null): Promise<void> {
  return setPref(KEY, profile && JSON.stringify(profile));
}

/**
 * The profile, or undefined while it's being worked out, or null when there's none (not an
 * athlete, or offline on a device that never synced).
 */
export function useTrainingProfile(): TrainingProfile | null | undefined {
  const me = useMe();
  const [saved, setSaved] = useState<TrainingProfile | null | undefined>(undefined);
  const live = me.data ? profileFrom(me.data) : undefined;
  const key = live ? JSON.stringify(live) : '';

  useEffect(() => {
    savedProfile().then(setSaved);
  }, []);
  useEffect(() => {
    if (key) saveProfile(JSON.parse(key));
  }, [key]);

  if (live !== undefined) return live;
  const offline = me.error instanceof ApiError && me.error.offline;
  if (offline) return saved;
  return me.isPending || saved === undefined ? undefined : null;
}
