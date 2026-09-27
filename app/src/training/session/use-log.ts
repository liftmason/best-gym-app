/** A session log and everything its screens read, live. */
import { useLocalSearchParams } from 'expo-router';

import { editable } from '@/domain/sessions';
import { useSync } from '@/sync/provider';

import { useTraining } from '../use-training';

export function useLog() {
  const { log: logId, n } = useLocalSearchParams<{ log: string; n?: string }>();
  const world = useTraining();
  const { engine, profile } = useSync();
  const log = world?.log.get(logId);
  const coach = profile.coachName?.split(/\s+/)[0] ?? 'your coach';
  return {
    logId,
    n: Math.max(1, Number(n) || 1),
    world,
    log,
    engine,
    profile,
    coach,
    open: log ? editable(log, new Date().toISOString()) : false,
  };
}

export type SessionPath = '/session/[log]/checkin' | '/session/[log]/summary' | '/session/[log]/player' | '/session/[log]/finish' | '/session/[log]/done';
