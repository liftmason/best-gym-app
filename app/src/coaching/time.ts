/** "just now", "12 min ago", "3h ago", "yesterday", "4 days ago", "Mon 21 Sep". */
import { dayMonth } from '@/training/format';

export function agoFrom(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return dayMonth(new Date(Date.parse(iso)).toISOString().slice(0, 10));
}
