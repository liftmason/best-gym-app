/**
 * `metrics.update`: the athlete's own numbers, weights in their unit. Bodyweight and lift
 * maxes are new dated rows (the latest wins); height and years training live on the
 * athlete's profile, which isn't synced, so the phone shows them from the outbox until the
 * next /me (training/profile).
 */
import { cleanMetric, InvalidMetric, LIFT_PREFIX } from '@/domain/metrics';
import { toKg } from '@/domain/units';
import type { ExerciseRow, TrackedLiftRow } from '@/domain/world';

import { derivedId } from '../aliases';

import { row } from './sessions-local';
import { Refused, type Action } from './types';

export type MetricsUpdate = { values: Record<string, string>; date?: string | null };

export const metricsUpdate: Action<MetricsUpdate> = {
  name: 'metrics.update',
  async apply(local, { values, date }, { id, at, athleteId, day, units }) {
    const when = date || day;
    if (when > day) throw new Refused('That date is in the future.');
    const tracked = (await local.find('exercises_trackedlift', {})) as TrackedLiftRow[];
    const lifts = new Map<string, ExerciseRow>();
    for (const t of tracked) {
      const e = (await local.get('exercises_exercise', t.exercise_id)) as ExerciseRow | null;
      if (e) lifts.set(`${LIFT_PREFIX}${e.id}`, e);
    }
    const cleaned: Record<string, string> = {};
    for (const [key, raw] of Object.entries(values)) {
      const lift = lifts.get(key);
      const known = lift || ['bodyweight', 'height_cm', 'years_training'].includes(key);
      if (!known) continue; // not one of the gym's metrics: ignored, as on the server
      const spec = {
        key,
        label: lift ? `${lift.name} 1RM` : key === 'bodyweight' ? 'Bodyweight' : key === 'height_cm' ? 'Height' : 'Years training',
        kind: key === 'height_cm' ? 'height' : key === 'years_training' ? 'years' : 'weight',
        lift: Boolean(lift),
      };
      try {
        const value = cleanMetric(spec, raw);
        if (value !== null) cleaned[key] = value;
      } catch (error) {
        throw error instanceof InvalidMetric ? new Refused(error.message) : error;
      }
    }
    if (cleaned.bodyweight) {
      await local.put(
        'accounts_bodyweightentry',
        row({ id: derivedId('bodyweight', id), athlete_id: athleteId, date: when, kg: toKg(cleaned.bodyweight, units), source: 'athlete', created_at: at }),
      );
    }
    for (const [key, lift] of lifts) {
      if (!cleaned[key]) continue;
      await local.put(
        'accounts_maxentry',
        row({
          id: derivedId('max', id, key),
          athlete_id: athleteId,
          exercise_id: lift.id,
          date: when,
          kg: toKg(cleaned[key], units),
          reps: 1,
          source: 'athlete',
          set_log_id: null,
          created_at: at,
        }),
      );
    }
  },
};
