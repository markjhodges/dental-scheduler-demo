import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SyntheticPracticeSystem } from '../src/integrations/synthetic';
import { pool, query, practiceId } from '../src/lib/db';
import { UnknownOutcomeError } from '../src/lib/errors';

const run=process.env.RUN_DB_TESTS==='1' && process.env.APP_MODE==='synthetic';
const integration=run?test:test.skip;
const patientId='20000000-0000-4000-8000-000000000001';
const hygienistId='30000000-0000-4000-8000-000000000003';
const dentistId='30000000-0000-4000-8000-000000000001';
const operatoryId='40000000-0000-4000-8000-000000000001';

integration('simulator serializes competing bookings and preserves a failed move',async()=>{
  const system=new SyntheticPracticeSystem();
  const p=practiceId();
  const base=new Date(Date.now()+400*86_400_000);
  base.setUTCHours(17,0,0,0);
  const startsAt=base.toISOString();
  const endsAt=new Date(base.getTime()+3_600_000).toISOString();
  const slot={startsAt,endsAt,hygienistId,dentistId,operatoryId};
  const ids:string[]=[];
  try {
    const operations=[randomUUID(),randomUUID()];
    const writes=operations.map(operationId=>system.book({operationId,practiceId:p,patientId,appointmentTypeId:'adult-cleaning',xrayPreference:null,...slot}));
    const results=await Promise.allSettled(writes);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    const winner=results.find(r=>r.status==='fulfilled');
    assert.ok(winner&&winner.status==='fulfilled');
    ids.push(winner.value.id);
    assert.equal((await system.findOperation(p,operations[0]))?.id===winner.value.id ||
      (await system.findOperation(p,operations[1]))?.id===winner.value.id,true);
    const later={...slot,startsAt:new Date(base.getTime()+2*3_600_000).toISOString(),
      endsAt:new Date(base.getTime()+3*3_600_000).toISOString()};
    const other=await system.book({operationId:randomUUID(),practiceId:p,patientId,appointmentTypeId:'adult-cleaning',xrayPreference:null,...later});
    ids.push(other.id);
    await assert.rejects(system.move(randomUUID(),p,winner.value.id,later),/slot_unavailable|This time was taken/);
    assert.equal((await system.appointment(p,winner.value.id))?.starts_at,startsAt);
    process.env.SIMULATOR_LOST_RESPONSE='1';
    const lostId=randomUUID();
    const laterStill={...slot,startsAt:new Date(base.getTime()+4*3_600_000).toISOString(),
      endsAt:new Date(base.getTime()+5*3_600_000).toISOString()};
    await assert.rejects(system.book({operationId:lostId,practiceId:p,patientId,appointmentTypeId:'adult-cleaning',xrayPreference:null,...laterStill}),UnknownOutcomeError);
    delete process.env.SIMULATOR_LOST_RESPONSE;
    const accepted=await system.findOperation(p,lostId);
    assert.ok(accepted);
    ids.push(accepted.id);
  } finally {
    delete process.env.SIMULATOR_LOST_RESPONSE;
    if(ids.length){
      await query('DELETE FROM simulator.allocation WHERE appointment_id=ANY($1::uuid[])',[ids]);
      await query('DELETE FROM simulator.operation_receipt WHERE appointment_id=ANY($1::uuid[])',[ids]);
      await query('DELETE FROM simulator.appointment WHERE id=ANY($1::uuid[])',[ids]);
    }
    await pool.end();
  }
});
