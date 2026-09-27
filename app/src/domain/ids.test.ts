import { uuid7 } from './ids';

const counting = (bytes: Uint8Array) => bytes.map((_, i) => i * 17);

test('a version 7 id starting with the time, sortable by it', () => {
  const ms = Date.UTC(2026, 8, 24, 16);
  const id = uuid7(ms, counting);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(id.replace(/-/g, '').slice(0, 12)).toBe(ms.toString(16).padStart(12, '0'));
  expect(uuid7(1000, counting) < uuid7(2000, counting)).toBe(true);
});
