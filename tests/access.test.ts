import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPatient, type Actor } from '../src/lib/auth';
import { pool, query, practiceId } from '../src/lib/db';

const integration=process.env.RUN_DB_TESTS==='1'&&process.env.APP_MODE==='synthetic'?test:test.skip;

integration('shared phone does not grant access and revocation takes effect',async()=>{
  const p=practiceId();
  const morgan:Actor={id:'10000000-0000-4000-8000-000000000001',practice_id:p,display_name:'Morgan Example',role:'patient'};
  const taylor:Actor={id:'10000000-0000-4000-8000-000000000002',practice_id:p,display_name:'Taylor Example',role:'patient'};
  const casey='20000000-0000-4000-8000-000000000003';
  const grant=await query<{id:string}>('SELECT id FROM app.guardian_grant WHERE account_id=$1 AND patient_id=$2',[morgan.id,casey]);
  assert.ok(grant.rows[0]);
  try {
    assert.equal(await canAccessPatient(morgan,casey,'appointments'),true);
    assert.equal(await canAccessPatient(taylor,casey,'appointments'),false);
    assert.equal(await canAccessPatient({...morgan,practice_id:'00000000-0000-4000-8000-000000000099'},casey,'appointments'),false);
    await query('UPDATE app.guardian_grant SET revoked_at=now() WHERE id=$1',[grant.rows[0].id]);
    assert.equal(await canAccessPatient(morgan,casey,'appointments'),false);
  } finally {
    await query('UPDATE app.guardian_grant SET revoked_at=NULL WHERE id=$1',[grant.rows[0].id]);
    await pool.end();
  }
});
