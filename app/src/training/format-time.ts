/** "just now", "5 min ago", "2h ago", "yesterday", or "Mon 21 Sep" for a message's time. */
import { localDate } from '@/domain/dates';
import { addDays } from '@/domain/world';

import { dayMonth } from './format';

export function sentAgo(iso: string, nowIso: string, timezone: string): string {
  const minutes = Math.floor((Date.parse(nowIso) - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const day = localDate(iso, timezone);
  const today = localDate(nowIso, timezone);
  if (day === today) return `${Math.floor(minutes / 60)}h ago`;
  if (day === addDays(today, -1)) return 'yesterday';
  return dayMonth(day);
}
