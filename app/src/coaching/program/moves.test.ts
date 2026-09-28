import { week } from '../testing/board';
import { moveTargets, placement } from './moves';

const w = week();
const snatch = { kind: 'item' as const, itemId: 'rx-sn', name: 'Snatch' };
const squat = { kind: 'item' as const, itemId: 'rx-bs', name: 'Back Squat' };

test('dropping a card before another counts positions without the card itself', () => {
  // Back Squat is second on Saturday; dropped before Snatch it becomes first.
  expect(placement(w, squat, { dayId: 'd5', sessionId: 's-sat', beforeItemId: 'rx-sn' })).toMatchObject({ kind: 'move', sessionId: 's-sat', index: 0 });
  // Snatch dropped at the end of its own session goes after Back Squat: index 1 of the others.
  expect(placement(w, snatch, { dayId: 'd5', sessionId: 's-sat', beforeItemId: null })).toMatchObject({ index: 1 });
});

test("a drop where the card already is changes nothing", () => {
  expect(placement(w, snatch, { dayId: 'd5', sessionId: 's-sat', beforeItemId: 'rx-bs' })).toBeNull();
});

test('onto another day: its first session, or the day itself when it rests', () => {
  expect(placement(w, snatch, { dayId: 'd2', sessionId: null, beforeItemId: null })).toMatchObject({ kind: 'move', sessionId: 's-wed', index: 1 });
  expect(placement(w, snatch, { dayId: 'd0', sessionId: null, beforeItemId: null })).toMatchObject({ kind: 'move', dayId: 'd0', sessionId: null, index: 0 });
});

test('an exercise from the rail is added where it lands', () => {
  const ex = { kind: 'exercise' as const, exercise: { id: 'ex-pp', name: 'Power Clean' } };
  expect(placement(w, ex, { dayId: 'd5', sessionId: 's-sat', beforeItemId: 'rx-bs' })).toMatchObject({ kind: 'add', sessionId: 's-sat', index: 1 });
  expect(placement(w, ex, { dayId: 'd1', sessionId: null, beforeItemId: null })).toMatchObject({ kind: 'add', day: { id: 'd1' }, sessionId: null, index: null });
});

test('"Move to…" offers every other session and the rest days', () => {
  const labels = moveTargets(w, 'rx-cj').map((t) => t.label);
  expect(labels).toEqual(['Mon (rest day)', 'Tue (rest day)', 'Thu (rest day)', 'Fri (rest day)', 'Sat', 'Sun (rest day)']);
  expect(moveTargets(w, 'rx-sn').map((t) => t.label)).toContain('Sat (to the end)');
});
