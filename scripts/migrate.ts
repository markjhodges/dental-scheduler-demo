import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from '../src/lib/db';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migration (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query<{filename:string}>('SELECT filename FROM public.schema_migration')).rows.map(x=>x.filename));
    for (const filename of (await readdir(resolve('migrations'))).filter(f=>f.endsWith('.sql')).sort()) {
      if (applied.has(filename)) continue;
      if (filename.includes('synthetic_seed') && process.env.APP_MODE !== 'synthetic') {
        console.log(`Skipping ${filename} outside synthetic mode`);continue;
      }
      const sql = await readFile(resolve('migrations',filename),'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migration(filename) VALUES ($1)',[filename]);
        await client.query('COMMIT');
        console.log(`Applied ${filename}`);
      } catch(error) { await client.query('ROLLBACK');throw error; }
    }
  } finally {client.release();await pool.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
