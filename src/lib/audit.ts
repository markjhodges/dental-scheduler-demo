import type { PoolClient } from 'pg';
import { query, practiceId } from './db';

export async function audit(action: string, targetType: string, targetId: string | null, outcome: string, actorId?: string | null, client?: PoolClient) {
  const sql = 'INSERT INTO app.audit_event(practice_id,actor_id,action,target_type,target_id,outcome) VALUES ($1,$2,$3,$4,$5,$6)';
  const params = [practiceId(), actorId ?? null, action, targetType, targetId, outcome];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}
