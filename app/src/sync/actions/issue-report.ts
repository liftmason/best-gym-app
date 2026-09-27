/** `issue.report`: pain, missing equipment, a prescription that looks wrong, or something else. */
import { logFor, row } from './sessions-local';
import { Refused, type Action } from './types';

export type IssueReport = { issue_id: string; session_log_id: string; kind: string; text: string };

export const ISSUE_KINDS = {
  pain: 'Pain / possible injury',
  equipment: 'Equipment not available',
  prescription: 'Prescription looks wrong',
  other: 'Something else',
} as const;
export const MAX_ISSUE_TEXT = 2000;

export const issueReport: Action<IssueReport> = {
  name: 'issue.report',
  async apply(local, { issue_id, session_log_id, kind, text }, { at, athleteId }) {
    const log = await logFor(local, session_log_id);
    if (await local.get('workouts_issuereport', issue_id)) return;
    if (!Object.hasOwn(ISSUE_KINDS, kind)) throw new Refused('Pick what kind of issue it is.');
    const body = (text ?? '').trim();
    if (body.length > MAX_ISSUE_TEXT) throw new Refused(`Keep it to ${MAX_ISSUE_TEXT} characters.`);
    await local.put(
      'workouts_issuereport',
      row({ id: issue_id, athlete_id: athleteId, session_log_id: log.id, kind, text: body, created_at: at, resolved_at: null }),
    );
  },
};
