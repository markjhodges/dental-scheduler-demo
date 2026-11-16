import { query, transaction, assertSynthetic } from '@/lib/db';
import { AppError, UnknownOutcomeError } from '@/lib/errors';
import type { ExternalAppointment, ExternalWrite, PatientRecord, PracticeSystem, SlotResources, TreatmentPlan } from './practice-system';

function normalizedDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
}

function normalizedPatient(row: PatientRecord): PatientRecord {
  return {...row,birth_date:normalizedDate(row.birth_date)!,recare_due:normalizedDate(row.recare_due),last_xray:normalizedDate(row.last_xray)};
}

function normalized(a: Record<string, unknown>): ExternalAppointment {
  return {
    id: String(a.id), patient_id: String(a.patient_id), appointment_type_id: String(a.appointment_type_id),
    starts_at: new Date(String(a.starts_at)).toISOString(), ends_at: new Date(String(a.ends_at)).toISOString(),
    hygienist_id: a.hygienist_id ? String(a.hygienist_id) : null,
    dentist_id: a.dentist_id ? String(a.dentist_id) : null,
    operatory_id: String(a.operatory_id), xray_preference: a.xray_preference ? String(a.xray_preference) : null,
    status: a.status as ExternalAppointment['status'], updated_at: new Date(String(a.updated_at)).toISOString(),
  };
}

async function responseFault() {
  if (process.env.SIMULATOR_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Math.min(Number(process.env.SIMULATOR_DELAY_MS), 5000)));
  if (process.env.SIMULATOR_LOST_RESPONSE === '1') throw new UnknownOutcomeError('Accepted write with lost response');
}

function checkAvailable() {
  assertSynthetic();
  if (process.env.SIMULATOR_OUTAGE === '1') throw new AppError('practice_system_unavailable', 503, 'Scheduling is temporarily unavailable.');
}

async function allocate(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, appointmentId: string, practiceId: string, slot: SlotResources) {
  for (const resourceId of [slot.hygienistId, slot.dentistId, slot.operatoryId].filter(Boolean)) {
    await client.query(`INSERT INTO simulator.allocation(appointment_id,practice_id,resource_id,during)
      VALUES ($1,$2,$3,tstzrange($4,$5,'[)'))`, [appointmentId, practiceId, resourceId, slot.startsAt, slot.endsAt]);
  }
}

function conflict(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23P01') {
    throw new AppError('slot_unavailable', 409, 'This time was taken. Please choose another.');
  }
  throw error;
}

export class SyntheticPracticeSystem implements PracticeSystem {
  readonly capabilities = { immediateBooking: true, safeMove: true, treatmentEstimates: false, temporaryHold: false };

  async matchPatients(practiceId: string, firstName: string, lastName: string, birthDate: string): Promise<PatientRecord[]> {
    checkAvailable();
    const result = await query<PatientRecord>(`SELECT id,first_name,last_name,birth_date::text AS birth_date,phone,email,
      recare_due::text AS recare_due,last_xray::text AS last_xray FROM simulator.patient
      WHERE practice_id=$1 AND lower(first_name)=lower($2)
      AND lower(last_name)=lower($3) AND birth_date=$4`, [practiceId, firstName, lastName, birthDate]);
    return result.rows.map(normalizedPatient);
  }
  async patient(practiceId: string, patientId: string): Promise<PatientRecord | null> {
    checkAvailable();
    const result = await query<PatientRecord>(`SELECT id,first_name,last_name,birth_date::text AS birth_date,phone,email,
      recare_due::text AS recare_due,last_xray::text AS last_xray FROM simulator.patient WHERE practice_id=$1 AND id=$2`, [practiceId, patientId]);
    return result.rows[0] ? normalizedPatient(result.rows[0]) : null;
  }
  async appointments(practiceId: string, from: string, to: string): Promise<ExternalAppointment[]> {
    checkAvailable();
    const result = await query('SELECT * FROM simulator.appointment WHERE practice_id=$1 AND status=$2 AND starts_at<$4 AND ends_at>$3', [practiceId, 'confirmed', from, to]);
    return result.rows.map(normalized);
  }
  async patientAppointments(practiceId: string, patientId: string): Promise<ExternalAppointment[]> {
    checkAvailable();
    const result = await query('SELECT * FROM simulator.appointment WHERE practice_id=$1 AND patient_id=$2 ORDER BY starts_at DESC', [practiceId, patientId]);
    return result.rows.map(normalized);
  }
  async appointment(practiceId: string, appointmentId: string): Promise<ExternalAppointment | null> {
    checkAvailable();
    const result = await query('SELECT * FROM simulator.appointment WHERE practice_id=$1 AND id=$2', [practiceId, appointmentId]);
    return result.rows[0] ? normalized(result.rows[0]) : null;
  }
  async changedAppointments(practiceId: string, cursor: string | null) {
    checkAvailable();
    const [afterTime,afterId] = cursor?.split('|') ?? ['1970-01-01T00:00:00.000Z','00000000-0000-0000-0000-000000000000'];
    const result = await query<{cursor_time:string;id:string} & Record<string,unknown>>(`SELECT *,
      to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      FROM simulator.appointment WHERE practice_id=$1
      AND (updated_at,id)>($2::timestamptz,$3::uuid) ORDER BY updated_at,id LIMIT 100`,
      [practiceId,afterTime,afterId]);
    const appointments = result.rows.map(normalized);
    const last = result.rows.at(-1);
    return {appointments,nextCursor:last?`${last.cursor_time}|${last.id}`:cursor};
  }
  async treatmentPlans(practiceId: string, patientId: string): Promise<TreatmentPlan[]> {
    checkAvailable();
    const result = await query<TreatmentPlan>(`SELECT p.*, coalesce(json_agg(json_build_object('id',v.id,'sequence',v.sequence,
      'description',v.description,'dentist_duration_minutes',v.dentist_duration_minutes) ORDER BY v.sequence)
      FILTER (WHERE v.id IS NOT NULL),'[]') AS visits
      FROM simulator.treatment_plan p LEFT JOIN simulator.treatment_visit v ON v.plan_id=p.id
      WHERE p.practice_id=$1 AND p.patient_id=$2 GROUP BY p.id`, [practiceId, patientId]);
    return result.rows;
  }
  async treatmentPlansForDentist(practiceId: string, dentistId: string): Promise<TreatmentPlan[]> {
    checkAvailable();
    const result = await query<TreatmentPlan>(`SELECT p.*, coalesce(json_agg(json_build_object('id',v.id,'sequence',v.sequence,
      'description',v.description,'dentist_duration_minutes',v.dentist_duration_minutes) ORDER BY v.sequence)
      FILTER (WHERE v.id IS NOT NULL),'[]') AS visits
      FROM simulator.treatment_plan p LEFT JOIN simulator.treatment_visit v ON v.plan_id=p.id
      WHERE p.practice_id=$1 AND p.diagnosing_dentist_id=$2 GROUP BY p.id`, [practiceId,dentistId]);
    return result.rows;
  }

  async book(write: ExternalWrite): Promise<ExternalAppointment> {
    checkAvailable();
    if (process.env.SIMULATOR_REJECT_WRITES === '1') throw new AppError('practice_system_rejected', 409, 'The practice system rejected this booking.');
    let appointment: ExternalAppointment;
    try {
      appointment = await transaction(async client => {
        const prior = await client.query('SELECT appointment_id FROM simulator.operation_receipt WHERE operation_id=$1 AND practice_id=$2', [write.operationId, write.practiceId]);
        if (prior.rows[0]) {
          const found = await client.query('SELECT * FROM simulator.appointment WHERE id=$1', [prior.rows[0].appointment_id]);
          return normalized(found.rows[0]);
        }
        const result = await client.query(`INSERT INTO simulator.appointment(practice_id,patient_id,appointment_type_id,starts_at,ends_at,
          hygienist_id,dentist_id,operatory_id,xray_preference,status,operation_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10) RETURNING *`,
          [write.practiceId, write.patientId, write.appointmentTypeId, write.startsAt, write.endsAt,
            write.hygienistId, write.dentistId, write.operatoryId, write.xrayPreference, write.operationId]);
        await allocate(client, result.rows[0].id, write.practiceId, write);
        await client.query('INSERT INTO simulator.operation_receipt(operation_id,practice_id,appointment_id,command) VALUES ($1,$2,$3,$4)',
          [write.operationId, write.practiceId, result.rows[0].id, 'book']);
        return normalized(result.rows[0]);
      });
    } catch (error) { conflict(error); }
    await responseFault();
    return appointment;
  }

  async move(operationId: string, practiceId: string, appointmentId: string, slot: SlotResources): Promise<ExternalAppointment> {
    checkAvailable();
    if (process.env.SIMULATOR_REJECT_WRITES === '1') throw new AppError('practice_system_rejected', 409);
    let appointment: ExternalAppointment;
    try {
      appointment = await transaction(async client => {
        const prior = await client.query('SELECT 1 FROM simulator.operation_receipt WHERE operation_id=$1 AND practice_id=$2', [operationId, practiceId]);
        const existing = await client.query('SELECT * FROM simulator.appointment WHERE id=$1 AND practice_id=$2 FOR UPDATE', [appointmentId, practiceId]);
        if (!existing.rows[0]) throw new AppError('appointment_not_found', 404);
        if (prior.rowCount) return normalized(existing.rows[0]);
        if (existing.rows[0].status !== 'confirmed') throw new AppError('appointment_not_changeable', 409);
        await client.query('DELETE FROM simulator.allocation WHERE appointment_id=$1', [appointmentId]);
        await allocate(client, appointmentId, practiceId, slot);
        const updated = await client.query(`UPDATE simulator.appointment SET starts_at=$1,ends_at=$2,hygienist_id=$3,
          dentist_id=$4,operatory_id=$5,updated_at=now() WHERE id=$6 RETURNING *`,
          [slot.startsAt,slot.endsAt,slot.hygienistId,slot.dentistId,slot.operatoryId,appointmentId]);
        await client.query('INSERT INTO simulator.operation_receipt(operation_id,practice_id,appointment_id,command) VALUES ($1,$2,$3,$4)',
          [operationId,practiceId,appointmentId,'move']);
        return normalized(updated.rows[0]);
      });
    } catch (error) { conflict(error); }
    await responseFault();
    return appointment;
  }

  async cancel(operationId: string, practiceId: string, appointmentId: string): Promise<ExternalAppointment> {
    checkAvailable();
    if (process.env.SIMULATOR_REJECT_WRITES === '1') throw new AppError('practice_system_rejected', 409);
    const appointment = await transaction(async client => {
      const prior = await client.query('SELECT 1 FROM simulator.operation_receipt WHERE operation_id=$1 AND practice_id=$2', [operationId, practiceId]);
      const existing = await client.query('SELECT * FROM simulator.appointment WHERE id=$1 AND practice_id=$2 FOR UPDATE', [appointmentId, practiceId]);
      if (!existing.rows[0]) throw new AppError('appointment_not_found', 404);
      if (prior.rowCount) return normalized(existing.rows[0]);
      if (existing.rows[0].status !== 'confirmed') throw new AppError('appointment_not_changeable', 409);
      await client.query('DELETE FROM simulator.allocation WHERE appointment_id=$1', [appointmentId]);
      const updated = await client.query("UPDATE simulator.appointment SET status='cancelled',updated_at=now() WHERE id=$1 RETURNING *", [appointmentId]);
      await client.query('INSERT INTO simulator.operation_receipt(operation_id,practice_id,appointment_id,command) VALUES ($1,$2,$3,$4)',
        [operationId,practiceId,appointmentId,'cancel']);
      return normalized(updated.rows[0]);
    });
    await responseFault();
    return appointment;
  }
  async findOperation(practiceId: string, operationId: string): Promise<ExternalAppointment | null> {
    checkAvailable();
    const result = await query(`SELECT a.* FROM simulator.operation_receipt r JOIN simulator.appointment a ON a.id=r.appointment_id
      WHERE r.practice_id=$1 AND r.operation_id=$2`, [practiceId, operationId]);
    return result.rows[0] ? normalized(result.rows[0]) : null;
  }
}
