import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const globalPool = globalThis as typeof globalThis & { dentalPool?: Pool };
export const pool = globalPool.dentalPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== 'production') globalPool.dentalPool = pool;

function requireDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  requireDatabase();
  return pool.query<T>(sql, params);
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  requireDatabase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function practiceId() {
  return process.env.PRACTICE_ID ?? '00000000-0000-4000-8000-000000000001';
}

export function assertSynthetic() {
  if (process.env.APP_MODE !== 'synthetic') throw new Error('Synthetic operation disabled outside APP_MODE=synthetic');
}
