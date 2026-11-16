import { pool, assertSynthetic } from '../src/lib/db';
import { spawnSync } from 'node:child_process';

async function main() {
  assertSynthetic();
  if (process.env.RESET_SYNTHETIC !== 'YES') throw new Error('Set RESET_SYNTHETIC=YES to reset synthetic schemas');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA IF EXISTS simulator CASCADE');
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    await client.query('DROP TABLE IF EXISTS public.schema_migration');
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();await pool.end();}
  const result=spawnSync(process.execPath,['./node_modules/tsx/dist/cli.mjs','scripts/migrate.ts'],{stdio:'inherit',env:process.env});
  if(result.status!==0) throw new Error('Migration failed after reset');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
