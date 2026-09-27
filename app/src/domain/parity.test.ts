/**
 * The phone's rules against the server's, on the same rows (shared/parity.json, written by
 * backend/tests/unit/test_parity.py). Each block rebuilds what that test records, in the
 * same shape, and must match it exactly.
 */
import parity from '../../../shared/parity.json';

import { chartLifts, e1rmPoints, phaseBands, progressChange } from './charts';
import { forDay } from './habits';
import {
  bestE1rm,
  compliance,
  e1rmText,
  exerciseHistory,
  lastLine,
  lifetimePrs,
  nextSessionDate,
  prSessionExercises,
  recentFinished,
  setsText,
  setText,
  streak,
  top,
  trend,
} from './history';
import { banner, lastTime, measureFor, resumePoint, setCounts, setRows, topSets } from './player';
import { sessionCandidates } from './prs';
import { plannedSets, prescribed, stepDone, steps } from './sessions';
import type { Unit } from './units';
import { weekView } from './week';
import { makeWorld, type Athlete, type Baseline, type Tables, type World } from './world';

type Expect = (typeof parity.expect)['kg'];

function world(unit: Unit): World {
  const athlete = { ...(parity.athlete as unknown as Athlete), units: unit };
  return makeWorld(
    parity.snapshot.tables as unknown as Tables,
    athlete,
    { today: parity.today, now: parity.now },
    parity.snapshot.history_from,
    parity.snapshot.baselines as Record<string, Baseline>,
  );
}

function weekJson(w: World, wanted: string | null) {
  const view = weekView(w, wanted, wanted);
  const out = { today: view.today, paused: view.paused.map((p) => p.id) };
  if (!view.week) return { ...out, week: null };
  return {
    ...out,
    week: view.week.id,
    number: view.number,
    start: view.week.start_date,
    strip: view.strip!.map((e) => ({
      date: e.day.date,
      status: e.status,
      count: e.count,
      is_today: e.is_today,
      selected: e.selected,
    })),
    cards: view.cards
      ? view.cards.map((c) => ({
          session: c.session.id,
          log: c.log?.id ?? null,
          items: c.items,
          count: c.count,
          state: c.state,
          editable: c.editable,
        }))
      : null,
    prev_week: view.prev_week?.id ?? null,
    next_week: view.next_week?.id ?? null,
  };
}

function playerJson(w: World, logId: string, unit: Unit) {
  const log = w.log.get(logId)!;
  const exercises = w.exercisesOfLog.get(logId) ?? [];
  const setsOf = (se: { id: string }) => w.setsOf.get(se.id) ?? [];
  const out = {
    resume: resumePoint(w, log),
    steps: steps(exercises).map((s) => ({
      warmup: s.warmup,
      items: s.items.map((se) => se.id),
      labels: s.labels,
      section: s.section,
      section_note: s.section_note,
      done: stepDone(s, setsOf),
    })),
    exercises: {} as Record<string, unknown>,
    counts: setCounts(w, log),
    top_sets: topSets(w, log),
    candidates: sessionCandidates(w, log).map((c) => [c.set.id, c.current.id]),
  };
  for (const se of exercises) {
    const p = prescribed(se);
    const [rows, timeUnit] = setRows(w, se, p, unit);
    out.exercises[se.id] = {
      rows,
      time_unit: timeUnit,
      banner: banner(p, unit),
      last_time: lastTime(w, se, log, unit),
      measure: measureFor(w, se, p),
      planned_sets: plannedSets(se),
    };
  }
  return out;
}

function historyJson(w: World, unit: Unit) {
  const byExercise = exerciseHistory(w);
  return {
    lifetime_prs: lifetimePrs(w).map((pr) => ({
      exercise_id: pr.exercise_id,
      name: pr.name,
      heaviest: setText(pr.heaviest, unit),
      heaviest_date: pr.heaviest_date,
      e1rm: pr.e1rm ? e1rmText(pr.e1rm, unit) : null,
      e1rm_date: pr.e1rm_date,
      date: pr.date,
    })),
    pr_session_exercises: [...prSessionExercises(w)].sort(),
    streak: streak(w, w.today),
    compliance: compliance(w, w.today),
    next_session: nextSessionDate(w, w.today),
    recent: recentFinished(w).map((l) => l.id),
    exercises: Object.fromEntries(
      [...byExercise].map(([id, list]) => [
        id,
        {
          trend: trend(list),
          entries: list.map((e) => ({
            date: e.date,
            log: e.log_id,
            session_exercise: e.session_exercise_id,
            top: setText(top(e.sets), unit),
            best_e1rm: bestE1rm(e.sets),
            sets: setsText(e.sets, unit),
            last_line: lastLine(e, unit, w.today),
          })),
        },
      ]),
    ),
  };
}

describe.each(['kg', 'lb'] as const)('the server and the phone agree, in %s', (unit) => {
  const w = world(unit);
  const expected = parity.expect[unit] as Expect;

  test.each(expected.week.map((c) => [c.wanted_day ?? 'the default day', c]))('the week, opened on %s', (_, c) => {
    expect(weekJson(w, c.wanted_day)).toEqual(c.view);
  });

  test.each(Object.keys(expected.player))('the player for log %s', (logId) => {
    expect(playerJson(w, logId, unit)).toEqual((expected.player as Record<string, unknown>)[logId]);
  });

  test('history: PRs, streaks, compliance and each lift', () => {
    expect(historyJson(w, unit)).toEqual(expected.history);
  });

  test('the progress charts', () => {
    const lifts = chartLifts(w);
    const charts = Object.fromEntries(
      lifts.map((e) => {
        const points = e1rmPoints(w, e.id);
        return [e.id, { points, bands: phaseBands(points), change: progressChange(w, e.id) }];
      }),
    );
    expect({ lifts: lifts.map((e) => e.id), charts }).toEqual(expected.charts);
  });
});

test.each(Object.keys(parity.expect.habits))('habits on %s', (date) => {
  const w = world('kg');
  const items = forDay(w, date).map((i) => ({
    habit: i.habit.id,
    done: i.done,
    met_for_week: i.met_for_week,
    week_count: i.week_count,
    streak: i.streak,
  }));
  expect(items).toEqual((parity.expect.habits as Record<string, unknown>)[date]);
});
