/** Check-in answers (backend apps/workouts/checkins.py). */
import type { QuestionRow } from './world';

export const OTHER_OPTION = 'Other';
export const MAX_DETAIL = 300;
export const MAX_TEXT = 200;
const SCALE = new Set(Array.from({ length: 10 }, (_, i) => String(i + 1)));

export class InvalidAnswer extends Error {}

/** [value, other text] to store; InvalidAnswer for what the question doesn't accept. */
export function cleanAnswer(
  question: Pick<QuestionRow, 'type' | 'options' | 'detail_label'>,
  value: string | null,
  other: string | null = '',
): [string, string] {
  const v = String(value ?? '').trim();
  const o = String(other ?? '').trim();
  if (question.type === 'scale') {
    if (!SCALE.has(v)) throw new InvalidAnswer('Pick a number from 1 to 10.');
    return [v, question.detail_label ? o.slice(0, MAX_DETAIL) : ''];
  }
  if (question.type === 'text') return [v.split(/\s+/).filter(Boolean).join(' ').slice(0, MAX_TEXT), ''];
  if (![...question.options, OTHER_OPTION].includes(v)) throw new InvalidAnswer('Pick one of the options.');
  return [v, v === OTHER_OPTION ? o.slice(0, MAX_DETAIL) : ''];
}
