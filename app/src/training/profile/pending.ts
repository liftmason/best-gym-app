/** Height and years training waiting in the outbox (metrics.update), shown until /me catches up. */
import type { Database } from '@/db/database';

export async function pendingProfile(database: Database): Promise<{ height_cm?: string; years_training?: string }> {
  const rows = await database.query("SELECT payload FROM outbox WHERE name = 'metrics.update' ORDER BY seq");
  const out: { height_cm?: string; years_training?: string } = {};
  for (const [payload] of rows) {
    const values = (JSON.parse(payload as string).values ?? {}) as Record<string, string>;
    if (values.height_cm?.trim()) out.height_cm = values.height_cm.trim();
    if (values.years_training) out.years_training = values.years_training;
  }
  return out;
}
