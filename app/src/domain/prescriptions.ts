/** How a prescription reads, and a session's layout (backend apps/programs/prescriptions.py). */
import { display, norm, type Unit } from './units';
import type { CustomField } from './world';

/** '2', '1–2' or '' for an RIR target. */
export function rirText(rir: number | null, rirMax: number | null): string {
  if (rir === null) return '';
  return rirMax !== null ? `${rir}–${rirMax}` : String(rir);
}

/** '75%', 'RPE 8', '100 kg', 'BW' or '' for a load, in the viewer's unit. */
export function loadText(basis: string, value: string | null, unit: Unit): string {
  if (basis === 'bodyweight') return 'BW';
  if (value === null || basis === 'none') return '';
  if (basis === 'percent') return `${norm(value)}%`;
  if (basis === 'rpe') return `RPE ${norm(value)}`;
  return display(value, unit);
}

export type Dose = {
  sets: number;
  rep_scheme: string;
  load_basis: string;
  load_value: string | null;
  rir: number | null;
  rir_max: number | null;
  custom_fields: CustomField[] | null;
  warmup?: boolean;
};
export type Override = { set_number: number; rep_scheme: string; reps: number | null; load_value: string | null };

/** '5×3 @ 75% · RIR 2 · Tempo 3-1-0' (custom fields left out with custom=false). */
export function summary(rx: Dose, unit: Unit, overrides: Override[], custom = true): string {
  if (rx.warmup) return rx.rep_scheme || 'warm-up';
  let text: string;
  if (overrides.length) {
    const parts = overrides.map((s) => {
      const reps = s.rep_scheme || rx.rep_scheme;
      const load = loadText(rx.load_basis, s.load_value !== null ? s.load_value : rx.load_value, unit);
      return load ? `${reps}@${load}` : reps;
    });
    text = `${overrides.length} sets: ${parts.join(', ')}`;
  } else {
    text = rx.rep_scheme ? `${rx.sets}×${rx.rep_scheme}` : `${rx.sets} set${rx.sets !== 1 ? 's' : ''}`;
    const load = loadText(rx.load_basis, rx.load_value, unit);
    if (load) text += ` @ ${load}`;
  }
  if (rx.rir !== null) text += ` · RIR ${rirText(rx.rir, rx.rir_max)}`;
  if (custom) for (const f of rx.custom_fields ?? []) text += ` · ${f.key ?? ''} ${f.value ?? ''}`.trimEnd();
  return text;
}

export type Placement = { warmup: boolean; superset: boolean; section: string; section_note: string };
export type LaidOut<T> = { item: T; section: string; section_note: string; label: string; first: boolean };

/** Warm-ups first, then the rest with section headings and superset labels ("A1", "A2"). */
export function layout<T>(items: T[], get: (item: T) => Placement): [T[], LaidOut<T>[]] {
  const warmups = items.filter((i) => get(i).warmup);
  const rest = items.filter((i) => !get(i).warmup);
  const groups: T[][] = [];
  rest.forEach((item, i) => {
    if (i && get(item).superset) groups[groups.length - 1].push(item);
    else groups.push([item]);
  });
  const entries: LaidOut<T>[] = [];
  groups.forEach((groupItems, n) => {
    const letter = n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
    groupItems.forEach((item, k) => {
      const p = get(item);
      entries.push({
        item,
        section: p.section,
        section_note: p.section_note,
        label: groupItems.length > 1 ? `${letter}${k + 1}` : '',
        first: k === 0,
      });
    });
  });
  return [warmups, entries];
}
