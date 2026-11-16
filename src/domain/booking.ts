import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, practiceId, transaction } from '@/lib/db';
import { AppError, UnknownOutcomeError } from '@/lib/errors';
import { assertPatientAccess, type Actor } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { practiceSystem } from '@/integrations';
import type { ExternalAppointment, SlotResources } from '@/integrations/practice-system';
import { searchAvailability, validateCandidate } from './availability';
import { onlineChangeAllowed } from './time';
import { localDate } from './time';

type Intent = {
  id: string; practice_id: string; actor_id: string; patient_id: string; appointment_type_id: string;
  starts_at: Date; ends_at: Date; hygienist_id: string|null; dentist_id: string|null;
  operatory_id: string; rule_version: number; xray_preference: 'yes'|'no'|'discuss'|null;
  expires_at: Date; status: string; source_appointment_id: string|null;
};
type Operation = { id: string; practice_id: string; actor_id: string; command: 'book'|'move'|'cancel';
  idempotency_key: string; payload_hash: string; intent_id: string|null; appointment_id: string|null;
  state: string; result: ExternalAppointment|null; error_code: string|null; created_at: Date };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function createIntent(actor: Actor, input: {
  patientId: string; appointmentTypeId: string; slot: SlotResources & {ruleVersion:number};
  xrayPreference?: 'yes'|'no'|'discuss'|null; sourceAppointmentId?: string;
}) {
  await assertPatientAccess(actor,input.patientId);
  const patient = await practiceSystem().patient(actor.practice_id,input.patientId);
  if (!patient) throw new AppError('patient_not_found',404);
  const today = localDate(new Date(),'America/Los_Angeles');
  const [year,month,day] = today.split('-').map(Number);
  const [birthYear,birthMonth,birthDay] = String(patient.birth_date).slice(0,10).split('-').map(Number);
  const age = year-birthYear-(month<birthMonth || (month===birthMonth && day<birthDay)?1:0);
  if ((input.appointmentTypeId==='child-cleaning'&&age>=18) || (input.appointmentTypeId==='adult-cleaning'&&age<18)) {
    throw new AppError('visit_type_ineligible',400,'Choose the visit type that matches the patient.');
  }
  if (input.sourceAppointmentId) {
    const original = await practiceSystem().appointment(actor.practice_id,input.sourceAppointmentId);
    if (!original || original.patient_id !== input.patientId || original.status !== 'confirmed') throw new AppError('appointment_not_found',404);
    if (!onlineChangeAllowed(new Date(original.starts_at))) throw new AppError('call_practice',409,'Call the practice to change an appointment within 24 hours.');
    if (original.appointment_type_id !== input.appointmentTypeId) throw new AppError('type_mismatch',400);
  }
  await validateCandidate({...input.slot,appointmentTypeId:input.appointmentTypeId,excludeAppointmentId:input.sourceAppointmentId});
  const result = await query<Intent>(`INSERT INTO app.booking_intent(practice_id,actor_id,patient_id,appointment_type_id,
    starts_at,ends_at,hygienist_id,dentist_id,operatory_id,rule_version,xray_preference,expires_at,source_appointment_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '10 minutes',$12) RETURNING *`,
    [actor.practice_id,actor.id,input.patientId,input.appointmentTypeId,input.slot.startsAt,input.slot.endsAt,
      input.slot.hygienistId,input.slot.dentistId,input.slot.operatoryId,input.slot.ruleVersion,
      input.xrayPreference ?? null,input.sourceAppointmentId ?? null]);
  await audit('booking.intent','booking_intent',result.rows[0].id,'created',actor.id);
  return {id:result.rows[0].id,expiresAt:result.rows[0].expires_at, status:'pending', holdGuaranteed:false};
}

async function getIntent(client: PoolClient, actor: Actor, intentId: string) {
  const result = await client.query<Intent>('SELECT * FROM app.booking_intent WHERE id=$1 AND practice_id=$2 AND actor_id=$3 FOR UPDATE',
    [intentId,actor.practice_id,actor.id]);
  if (!result.rows[0]) throw new AppError('intent_not_found',404);
  const intent = result.rows[0];
  if (intent.status !== 'pending' || intent.expires_at <= new Date()) throw new AppError('intent_expired',409,'Choose a time again.');
  return intent;
}

async function newOperation(actor: Actor, command: Operation['command'], key: string, payload: unknown,
  details: {intentId?:string;appointmentId?:string}) {
  if (!key || key.length > 128) throw new AppError('invalid_idempotency_key',400);
  const hash = digest(payload);
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`${actor.practice_id}:${actor.id}:${command}:${key}`]);
    const existing = await client.query<Operation>(`SELECT * FROM app.booking_operation WHERE practice_id=$1 AND actor_id=$2
      AND command=$3 AND idempotency_key=$4`,[actor.practice_id,actor.id,command,key]);
    if (existing.rows[0]) {
      if (existing.rows[0].payload_hash !== hash) throw new AppError('idempotency_mismatch',409);
      return existing.rows[0];
    }
    let intent: Intent|null = null;
    if (details.intentId) intent = await getIntent(client,actor,details.intentId);
    const appointmentId = details.appointmentId ?? intent?.source_appointment_id ?? null;
    if (appointmentId) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[appointmentId]);
      const pending = await client.query(`SELECT 1 FROM app.booking_operation WHERE practice_id=$1 AND appointment_id=$2
        AND state IN ('pending','submitting','reconciling') LIMIT 1`,[actor.practice_id,appointmentId]);
      if (pending.rowCount) throw new AppError('change_pending',409,'A change to this appointment is still pending.');
    }
    const inserted = await client.query<Operation>(`INSERT INTO app.booking_operation(practice_id,actor_id,command,idempotency_key,
      payload_hash,intent_id,appointment_id,state) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [actor.practice_id,actor.id,command,key,intent?.id ?? null,appointmentId]);
    if (intent) await client.query("UPDATE app.booking_intent SET status='submitted' WHERE id=$1",[intent.id]);
    await audit(`booking.${command}`,'booking_operation',inserted.rows[0].id,'pending',actor.id,client);
    return inserted.rows[0];
  });
}

async function persistAccepted(operation: Operation, appointment: ExternalAppointment) {
  await transaction(async client => {
    await client.query(`INSERT INTO app.appointment_projection(id,practice_id,patient_id,appointment_type_id,starts_at,ends_at,
      hygienist_id,dentist_id,operatory_id,status,xray_preference,source_updated_at,synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
      ON CONFLICT (id) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,
      hygienist_id=EXCLUDED.hygienist_id,dentist_id=EXCLUDED.dentist_id,operatory_id=EXCLUDED.operatory_id,
      status=EXCLUDED.status,xray_preference=EXCLUDED.xray_preference,source_updated_at=EXCLUDED.source_updated_at,synced_at=now()`,
      [appointment.id,operation.practice_id,appointment.patient_id,appointment.appointment_type_id,
        appointment.starts_at,appointment.ends_at,appointment.hygienist_id,appointment.dentist_id,
        appointment.operatory_id,appointment.status,appointment.xray_preference,appointment.updated_at]);
    await client.query(`UPDATE app.booking_operation SET state='succeeded',result=$1,appointment_id=$2,error_code=NULL,updated_at=now()
      WHERE id=$3`,[JSON.stringify(appointment),appointment.id,operation.id]);
    await client.query(`INSERT INTO app.outbox_event(practice_id,event_type,dedupe_key,payload)
      VALUES ($1,$2,$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`,
      [operation.practice_id,'appointment.changed',`appointment:${operation.id}`,JSON.stringify({appointmentId:appointment.id,command:operation.command})]);
    await audit(`booking.${operation.command}`,'appointment',appointment.id,'succeeded',operation.actor_id,client);
  });
  return {state:'succeeded',appointment,operationId:operation.id};
}

async function submit(operation: Operation) {
  const claimed = await query(`UPDATE app.booking_operation SET state='submitting',updated_at=now()
    WHERE id=$1 AND state='pending' RETURNING id`,[operation.id]);
  if (!claimed.rowCount) return {state:operation.state,appointment:operation.result,operationId:operation.id};
  let submissionStarted=false;
  let accepted=false;
  try {
    const external = practiceSystem();
    let appointment: ExternalAppointment;
    if (operation.command === 'cancel') {
      submissionStarted=true;
      appointment = await external.cancel(operation.id,operation.practice_id,operation.appointment_id!);
    } else {
      const intent = (await query<Intent>('SELECT * FROM app.booking_intent WHERE id=$1',[operation.intent_id])).rows[0];
      if (!intent) throw new AppError('intent_not_found',404);
      await validateCandidate({appointmentTypeId:intent.appointment_type_id,startsAt:intent.starts_at.toISOString(),
        endsAt:intent.ends_at.toISOString(),hygienistId:intent.hygienist_id,dentistId:intent.dentist_id,
        operatoryId:intent.operatory_id,ruleVersion:intent.rule_version,
        excludeAppointmentId:operation.command === 'move' ? operation.appointment_id! : undefined});
      const slot = {startsAt:intent.starts_at.toISOString(),endsAt:intent.ends_at.toISOString(),
        hygienistId:intent.hygienist_id,dentistId:intent.dentist_id,operatoryId:intent.operatory_id};
      if (operation.command === 'move') {
        const original = await external.appointment(operation.practice_id,operation.appointment_id!);
        if (!original || !onlineChangeAllowed(new Date(original.starts_at))) throw new AppError('call_practice',409,'Call the practice to change an appointment within 24 hours.');
        submissionStarted=true;
        appointment = await external.move(operation.id,operation.practice_id,operation.appointment_id!,slot);
      } else {
        submissionStarted=true;
        appointment = await external.book({...slot,operationId:operation.id,practiceId:operation.practice_id,
          patientId:intent.patient_id,appointmentTypeId:intent.appointment_type_id,xrayPreference:intent.xray_preference});
      }
    }
    accepted=true;
    return await persistAccepted(operation,appointment);
  } catch (error) {
    if (accepted || error instanceof UnknownOutcomeError || (submissionStarted && !(error instanceof AppError))) {
      await query("UPDATE app.booking_operation SET state='reconciling',updated_at=now() WHERE id=$1 AND state<>'succeeded'",[operation.id]);
      await audit(`booking.${operation.command}`,'booking_operation',operation.id,'unknown',operation.actor_id);
      return {state:'reconciling',appointment:null,operationId:operation.id};
    }
    const code = error instanceof AppError ? error.code : 'submission_failed';
    await query("UPDATE app.booking_operation SET state='rejected',error_code=$1,updated_at=now() WHERE id=$2",[code,operation.id]);
    await audit(`booking.${operation.command}`,'booking_operation',operation.id,'rejected',operation.actor_id);
    if (error instanceof AppError) throw error;
    throw new AppError('submission_failed',503,'Scheduling could not be completed. Please try again.');
  }
}

export async function confirmIntent(actor: Actor, intentId: string, key: string) {
  const intent = (await query<Intent>('SELECT * FROM app.booking_intent WHERE id=$1 AND practice_id=$2 AND actor_id=$3',
    [intentId,actor.practice_id,actor.id])).rows[0];
  if (!intent) throw new AppError('intent_not_found',404);
  await assertPatientAccess(actor,intent.patient_id);
  const command = intent.source_appointment_id ? 'move' : 'book';
  const operation = await newOperation(actor,command,key,{intentId}, {intentId});
  return submit(operation);
}

export async function cancelAppointment(actor: Actor, appointmentId: string, key: string) {
  const original = await practiceSystem().appointment(actor.practice_id,appointmentId);
  if (!original) throw new AppError('appointment_not_found',404);
  await assertPatientAccess(actor,original.patient_id);
  if (original.status !== 'confirmed') throw new AppError('appointment_not_changeable',409);
  if (!onlineChangeAllowed(new Date(original.starts_at))) throw new AppError('call_practice',409,'Call the practice to change an appointment within 24 hours.');
  const operation = await newOperation(actor,'cancel',key,{appointmentId},{appointmentId});
  return submit(operation);
}

export async function operationStatus(actor: Actor, operationId: string) {
  const result = await query<Operation>('SELECT * FROM app.booking_operation WHERE id=$1 AND practice_id=$2 AND actor_id=$3',
    [operationId,actor.practice_id,actor.id]);
  if (!result.rows[0]) throw new AppError('operation_not_found',404);
  return {id:result.rows[0].id,state:result.rows[0].state,appointment:result.rows[0].result,error:result.rows[0].error_code};
}

export async function reconcileOperations() {
  const operations = await query<Operation>(`SELECT * FROM app.booking_operation WHERE state IN ('reconciling','submitting')
    AND updated_at<now()-interval '5 seconds' ORDER BY updated_at LIMIT 50`);
  for (const operation of operations.rows) {
    try {
      const found = await practiceSystem().findOperation(operation.practice_id,operation.id);
      if (found) await persistAccepted(operation,found);
      else if (new Date().getTime() - operation.created_at.getTime() > 5 * 60_000) {
        await transaction(async client=>{
          await client.query("UPDATE app.booking_operation SET state='reconciling',error_code='outcome_unresolved',updated_at=now() WHERE id=$1",[operation.id]);
          const patient=await client.query<{patient_id:string}>(`SELECT patient_id FROM app.booking_intent WHERE id=$1
            UNION ALL SELECT patient_id FROM app.appointment_projection WHERE id=$2 LIMIT 1`,[operation.intent_id,operation.appointment_id]);
          if(patient.rows[0]) await client.query(`INSERT INTO app.review_task(practice_id,patient_id,kind,summary,target_id)
            SELECT $1,$2,'booking_reconciliation','Confirm authoritative appointment outcome before further changes.',$3
            WHERE NOT EXISTS (SELECT 1 FROM app.review_task WHERE practice_id=$1 AND kind='booking_reconciliation' AND target_id=$3)`,
            [operation.practice_id,patient.rows[0].patient_id,operation.id]);
        });
      }
    } catch (error) { console.error('Reconciliation failed:', error instanceof Error ? error.name : 'unknown'); }
  }
}
