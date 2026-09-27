/** Dates as the athlete's screens show them (English, as the mockup). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const parts = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return { month: d.getUTCMonth(), day: d.getUTCDate(), weekday: (d.getUTCDay() + 6) % 7 };
};

/** "Mon" */
export const shortDay = (date: string) => DAYS[parts(date).weekday];
/** "Monday" */
export const longDay = (date: string) => LONG[parts(date).weekday];
/** "Mon 21 Sep" */
export function dayMonth(date: string): string {
  const p = parts(date);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
}
/** "Sep 21–27", or "Sep 28–Oct 4" across a month. */
export function range(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  return `${MONTHS[a.month]} ${a.day}–${a.month === b.month ? '' : `${MONTHS[b.month]} `}${b.day}`;
}
