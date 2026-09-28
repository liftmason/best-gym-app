/** A program board as the API sends it (Maya's week 3), for the board's tests. */
import type { Board, Item, Week } from '@/coaching/program/queries';

const COMP = { id: 'wt-comp', name: 'Comp Prep', colour: '#D8412F' };
const ACC = { id: 'wt-acc', name: 'Accumulation', colour: '#2E9E5B' };

export const item = (id: string, name: string, summary: string, extra: Partial<Item> = {}): Item => ({
  id,
  exercise: { id: `ex-${name.toLowerCase().replace(/\W+/g, '-')}`, name },
  summary,
  heading: '',
  heading_note: '',
  label: '',
  warmup: false,
  tag_slot: false,
  ...extra,
});

const dates = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];

export function week(overrides: Partial<Week> = {}): Week {
  return {
    id: 'w3',
    label: 'Wk 3',
    start_date: '2026-09-21',
    published: false,
    week_type: COMP,
    focus_note: '',
    undo: null,
    days: dates.map((date, i) => ({
      id: `d${i}`,
      date,
      done: i === 5,
      sessions:
        i === 5
          ? [{ id: 's-sat', name: '', items: [item('rx-sn', 'Snatch', '6×2 @ 78%'), item('rx-bs', 'Back Squat', '5×3 @ 80%')] }]
          : i === 2
            ? [{ id: 's-wed', name: '', items: [item('rx-cj', 'Clean & Jerk', '5×1 @ 80%')] }]
            : [],
    })),
    ...overrides,
  };
}

export function board(overrides: Partial<Board> = {}): Board {
  const w = week();
  return {
    program: { id: 'p1', name: 'Comp Prep Block', note: '', start_date: '2026-09-07' },
    weeks: [
      { id: 'w1', label: 'Wk 1', start_date: '2026-09-07', published: true, week_type: ACC },
      { id: 'w2', label: 'Wk 2', start_date: '2026-09-14', published: true, week_type: ACC },
      { id: w.id, label: w.label, start_date: w.start_date, published: w.published, week_type: w.week_type },
    ],
    week: w,
    week_types: [ACC, COMP],
    ...overrides,
  };
}
