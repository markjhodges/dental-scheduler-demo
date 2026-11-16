import { pool, query, practiceId, transaction, assertSynthetic } from './lib/db';
import { reconcileOperations } from './domain/booking';
import { practiceSystem } from './integrations';

async function syncAppointments() {
  const p=practiceId();
  for(let batch=0;batch<10;batch++) {
    const checkpoint=await query<{cursor:string|null}>('SELECT cursor FROM app.sync_checkpoint WHERE practice_id=$1 AND stream=$2',[p,'appointments']);
    const cursor=checkpoint.rows[0]?.cursor??null;
    const changed=await practiceSystem().changedAppointments(p,cursor);
    if(!changed.appointments.length) return;
    await transaction(async client=>{
      for(const a of changed.appointments) await client.query(`INSERT INTO app.appointment_projection(id,practice_id,patient_id,appointment_type_id,
        starts_at,ends_at,hygienist_id,dentist_id,operatory_id,status,xray_preference,source_updated_at,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        ON CONFLICT(id) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
        hygienist_id=EXCLUDED.hygienist_id,dentist_id=EXCLUDED.dentist_id,operatory_id=EXCLUDED.operatory_id,
        status=EXCLUDED.status,xray_preference=EXCLUDED.xray_preference,
        source_updated_at=EXCLUDED.source_updated_at,synced_at=now()
        WHERE app.appointment_projection.source_updated_at<=EXCLUDED.source_updated_at`,
        [a.id,p,a.patient_id,a.appointment_type_id,a.starts_at,a.ends_at,a.hygienist_id,a.dentist_id,
          a.operatory_id,a.status,a.xray_preference,a.updated_at]);
      await client.query(`INSERT INTO app.sync_checkpoint(practice_id,stream,cursor,synced_at)
        VALUES ($1,'appointments',$2,now()) ON CONFLICT(practice_id,stream)
        DO UPDATE SET cursor=EXCLUDED.cursor,synced_at=EXCLUDED.synced_at`,[p,changed.nextCursor]);
    });
    if(changed.appointments.length<100) return;
  }
}

async function deliverOutbox() {
  const events=await query<{id:string;practice_id:string;event_type:string;payload:{appointmentId:string;command:string};attempts:number}>(`SELECT * FROM app.outbox_event
    WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at<=now() ORDER BY created_at LIMIT 20`);
  for(const event of events.rows) {
    try {
      if(event.event_type==='appointment.changed') {
        const appointment=await practiceSystem().appointment(event.practice_id,event.payload.appointmentId);
        if(!appointment) throw new Error('Appointment projection unavailable');
        const patient=await practiceSystem().patient(event.practice_id,appointment.patient_id);
        if(!patient) throw new Error('Patient unavailable');
        await transaction(async client=>{
          const locked=await client.query('SELECT delivered_at FROM app.outbox_event WHERE id=$1 FOR UPDATE',[event.id]);
          if(locked.rows[0]?.delivered_at) return;
          if(patient.email) await client.query(`INSERT INTO app.local_inbox(practice_id,channel,destination,body)
            VALUES ($1,'email',$2,$3)`,[event.practice_id,patient.email,'Your appointment was updated. Sign in to see the details.']);
          await client.query('UPDATE app.outbox_event SET delivered_at=now() WHERE id=$1',[event.id]);
        });
      }
    } catch(error) {
      console.error('Outbox delivery failed:',error);
      await query(`UPDATE app.outbox_event SET attempts=attempts+1,
        next_attempt_at=now()+make_interval(secs=>LEAST(300,power(2,attempts+1)::int)),
        failed_at=CASE WHEN attempts+1>=8 THEN now() ELSE NULL END WHERE id=$1`,[event.id]);
    }
  }
}

async function main() {
  assertSynthetic();
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  console.log(`Worker started for practice ${practiceId()}`);
  while(true) {
    try {await reconcileOperations();await syncAppointments();await deliverOutbox();}
    catch(error){console.error('Worker cycle failed:',error);}
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}
main().catch(async error=>{console.error(error);await pool.end();process.exitCode=1;});
