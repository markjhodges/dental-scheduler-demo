import { randomInt, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { canAccessPatient, requireActor, requireRole, requireSameOrigin, assertPatientAccess, createSession, removeSession, hashToken } from '@/lib/auth';
import { query, practiceId, transaction, assertSynthetic } from '@/lib/db';
import { AppError, errorResponse } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { practiceSystem } from '@/integrations';
import { schedulingCatalog, searchAvailability } from '@/domain/availability';
import { cancelAppointment, confirmIntent, createIntent, operationStatus } from '@/domain/booking';
import { localDate } from '@/domain/time';
import { benefitsEstimator } from '@/integrations/benefits';

export const runtime = 'nodejs';
type Context = { params: Promise<{path:string[]}> };
const uuid = z.uuid();
const date = z.iso.date();
const wallClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const slot = z.object({
  startsAt:z.iso.datetime({offset:true}), endsAt:z.iso.datetime({offset:true}),
  hygienistId:uuid.nullable(), dentistId:uuid.nullable(), operatoryId:uuid,
  ruleVersion:z.number().int().positive(),
});

async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const text = await request.text();
  if (text.length > 32_000) throw new AppError('body_too_large',413);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new AppError('invalid_json',400); }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError('invalid_input',400,parsed.error.issues[0]?.message ?? 'Invalid input.');
  return parsed.data;
}

function pathOf(path: string[]) { return `/${path.join('/')}`; }
function param(url: URL, key: string) { return url.searchParams.get(key) ?? ''; }

async function getHandler(request: Request, path: string[]) {
  const route = pathOf(path);
  const url = new URL(request.url);
  if (route === '/demo/inbox') {
    assertSynthetic();
    const messages = await query('SELECT id,channel,destination,body,created_at FROM app.local_inbox WHERE practice_id=$1 ORDER BY created_at DESC LIMIT 20',[practiceId()]);
    return Response.json({messages:messages.rows});
  }
  const actor = await requireActor();
  if (route === '/me') return Response.json({actor,mode:process.env.APP_MODE,features:{treatmentRequests:process.env.FEATURE_TREATMENT_REQUESTS==='1'}});
  if (route === '/catalog') return Response.json(await schedulingCatalog());
  if (route === '/patients') {
    const result = await query<{patient_id:string;relationship:string}>(`SELECT patient_id,'self' AS relationship FROM app.patient_link
      WHERE practice_id=$1 AND account_id=$2 UNION ALL SELECT patient_id,'guardian' AS relationship FROM app.guardian_grant
      WHERE practice_id=$1 AND account_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())
      AND 'appointments'=ANY(scope)`,[actor.practice_id,actor.id]);
    const patients = await Promise.all(result.rows.map(async row => ({...row, patient:await practiceSystem().patient(actor.practice_id,row.patient_id)})));
    return Response.json({patients});
  }
  if (route === '/availability') {
    const appointmentTypeId = param(url,'type'); const from = param(url,'from'); const to = param(url,'to');
    const providerId = param(url,'provider') || undefined;
    const sourceAppointmentId = param(url,'source') || undefined;
    if (sourceAppointmentId) {
      const original = await practiceSystem().appointment(actor.practice_id,sourceAppointmentId);
      if (!original) throw new AppError('appointment_not_found',404);
      await assertPatientAccess(actor,original.patient_id);
    }
    return Response.json({slots:await searchAvailability({appointmentTypeId,from,to,providerId,excludeAppointmentId:sourceAppointmentId,limit:80})});
  }
  if (path[0] === 'patients' && path.length === 2) {
    const patientId = uuid.parse(path[1]);
    await assertPatientAccess(actor,patientId);
    const external = practiceSystem();
    const [canHistory,canCosts] = await Promise.all([
      canAccessPatient(actor,patientId,'history'),canAccessPatient(actor,patientId,'costs'),
    ]);
    const [patient,appointments,plans,favorites,feedback,benefits,recordRequests,recareSchedule,recareMilestones,appointmentProcedures] = await Promise.all([
      external.patient(actor.practice_id,patientId), external.patientAppointments(actor.practice_id,patientId),
      canCosts ? external.treatmentPlans(actor.practice_id,patientId) : Promise.resolve([]),
      query('SELECT provider_id FROM app.provider_favorite WHERE practice_id=$1 AND patient_id=$2',[actor.practice_id,patientId]),
      canHistory ? query('SELECT id,appointment_id,provider_id,stars,comment,created_at FROM app.feedback WHERE practice_id=$1 AND patient_id=$2 ORDER BY created_at DESC',[actor.practice_id,patientId]) : Promise.resolve({rows:[]}),
      benefitsEstimator().estimateRoutine(actor.practice_id,patientId,'adult-cleaning'),
      canHistory ? query('SELECT id,status,created_at FROM app.record_request WHERE practice_id=$1 AND patient_id=$2 ORDER BY created_at DESC',[actor.practice_id,patientId]) : Promise.resolve({rows:[]}),
      canCosts ? query<{insurance_name:string|null}>('SELECT insurance_name FROM simulator.recare_schedule WHERE practice_id=$1 AND patient_id=$2',[actor.practice_id,patientId]) : Promise.resolve({rows:[]}),
      canHistory ? query<{procedure_key:string;procedure_name:string;category:string;last_completed_on:string|null;due_on:string|null}>(
        'SELECT procedure_key,procedure_name,category,last_completed_on::text,due_on::text FROM simulator.recare_milestone WHERE patient_id=$1 ORDER BY sort_order',[patientId]) : Promise.resolve({rows:[]}),
      canHistory ? query<{appointment_id:string;procedure_name:string}>(
        `SELECT ap.appointment_id,ap.procedure_name FROM simulator.appointment_procedure ap
         JOIN simulator.appointment a ON a.id=ap.appointment_id
         WHERE a.practice_id=$1 AND a.patient_id=$2 ORDER BY ap.sort_order`,[actor.practice_id,patientId]) : Promise.resolve({rows:[]}),
    ]);
    if (!patient) throw new AppError('patient_not_found',404);
    const diagnosing = plans.length ? await query<{id:string;name:string;active:boolean}>(
      'SELECT id,name,active FROM app.provider WHERE practice_id=$1 AND id=ANY($2::uuid[])',
      [actor.practice_id,plans.map(p=>p.diagnosing_dentist_id)]) : {rows:[]};
    await audit('patient.view','patient',patientId,'succeeded',actor.id);
    return Response.json({patient,appointments:(canHistory?appointments:appointments.filter(a=>a.status==='confirmed'&&new Date(a.starts_at)>new Date())).map(a=>({
      ...a,procedures:appointmentProcedures.rows.filter(p=>p.appointment_id===a.id).map(p=>p.procedure_name),
    })),plans:plans.map(p=>({...p,estimate:null,estimateStatus:'unavailable',
      diagnosingDentist:diagnosing.rows.find(d=>d.id===p.diagnosing_dentist_id)??null})),
      favorites:favorites.rows.map(r=>r.provider_id),feedback:feedback.rows,recordRequests:recordRequests.rows,
      recare:{insuranceName:recareSchedule.rows[0]?.insurance_name??null,milestones:recareMilestones.rows},
      coverageStatus:benefits.status,imagingNote:'Prior images and current needs should be reviewed by the dentist.'});
  }
  if (route === '/record-requests') {
    requireRole(actor,['patient']);
    const patientId=uuid.parse(param(url,'patient'));
    await assertPatientAccess(actor,patientId,'history');
    const requests=await query('SELECT id,status,created_at FROM app.record_request WHERE practice_id=$1 AND patient_id=$2 ORDER BY created_at DESC',[actor.practice_id,patientId]);
    return Response.json({requests:requests.rows});
  }
  if (path[0] === 'operations' && path.length === 2) return Response.json(await operationStatus(actor,uuid.parse(path[1])));
  if (route === '/admin/calendar') {
    requireRole(actor,['admin','staff']);
    const month = param(url,'month');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError('invalid_month',400);
    const end = new Date(`${month}-01T12:00:00Z`); end.setUTCMonth(end.getUTCMonth()+1);
    const [hours,exceptions] = await Promise.all([
      query('SELECT provider_id,weekday,start_local::text,end_local::text FROM app.provider_hours WHERE practice_id=$1',[actor.practice_id]),
      query('SELECT provider_id,local_date::text,available,start_local::text,end_local::text FROM app.availability_exception WHERE practice_id=$1 AND local_date >= $2 AND local_date < $3',
        [actor.practice_id,`${month}-01`,end.toISOString().slice(0,10)]),
    ]);
    return Response.json({hours:hours.rows,exceptions:exceptions.rows});
  }
  if (route === '/admin/feedback') {
    requireRole(actor,['admin']);
    const [metrics,comments] = await Promise.all([
      query(`SELECT p.id,p.name,count(f.id)::int AS count,round(avg(f.stars)::numeric,2) AS average
        FROM app.provider p LEFT JOIN app.feedback f ON f.provider_id=p.id AND f.practice_id=p.practice_id
        WHERE p.practice_id=$1 GROUP BY p.id ORDER BY p.name`,[actor.practice_id]),
      query(`SELECT f.id,f.appointment_id,f.provider_id,f.stars,f.comment,f.created_at
        FROM app.feedback f WHERE f.practice_id=$1 ORDER BY f.created_at DESC LIMIT 100`,[actor.practice_id]),
    ]);
    await audit('feedback.report','feedback',null,'succeeded',actor.id);
    return Response.json({metrics:metrics.rows,comments:comments.rows});
  }
  if (route === '/admin/review') {
    requireRole(actor,['admin','staff']);
    const tasks = await query('SELECT id,patient_id,kind,summary,status,target_id,created_at FROM app.review_task WHERE practice_id=$1 AND status=$2 ORDER BY created_at',[actor.practice_id,'open']);
    return Response.json({tasks:tasks.rows});
  }
  if (route === '/admin/guardian-grants') {
    requireRole(actor,['admin']);
    const grants=await query<{id:string;patient_id:string;account_name:string;scope:string[];revoked_at:string|null}>(`SELECT g.id,g.patient_id,a.display_name AS account_name,g.scope,g.revoked_at
      FROM app.guardian_grant g JOIN app.account a ON a.id=g.account_id
      WHERE g.practice_id=$1 ORDER BY g.reviewed_at DESC`,[actor.practice_id]);
    const named=await Promise.all(grants.rows.map(async g=>{
      const patient=await practiceSystem().patient(actor.practice_id,g.patient_id);
      return {...g,patientName:patient?`${patient.first_name} ${patient.last_name}`:'Patient'};
    }));
    await audit('guardian_grants.view','practice',actor.practice_id,'succeeded',actor.id);
    return Response.json({grants:named});
  }
  if (route === '/dentist/plans') {
    requireRole(actor,['dentist']);
    const membership=await query<{provider_id:string}>('SELECT provider_id FROM app.account WHERE id=$1 AND practice_id=$2',[actor.id,actor.practice_id]);
    const providerId=membership.rows[0]?.provider_id;
    if(!providerId) throw new AppError('provider_not_linked',403);
    const [plans,settings]=await Promise.all([
      practiceSystem().treatmentPlansForDentist(actor.practice_id,providerId),
      query<{treatment_visit_id:string;duration_minutes:number;scheduling_notes:string|null}>(
        'SELECT treatment_visit_id,duration_minutes,scheduling_notes FROM app.treatment_duration_setting WHERE practice_id=$1 AND dentist_id=$2',
        [actor.practice_id,providerId]),
    ]);
    const patients=await Promise.all(plans.map(p=>practiceSystem().patient(actor.practice_id,p.patient_id)));
    await audit('treatment.plans.view','provider',providerId,'succeeded',actor.id);
    return Response.json({plans:plans.map((p,i)=>({...p,patientName:patients[i]?`${patients[i]!.first_name} ${patients[i]!.last_name}`:'Patient',visits:p.visits.map(v=>({...v,
      setting:settings.rows.find(s=>s.treatment_visit_id===v.id)??null}))}))});
  }
  throw new AppError('not_found',404);
}

async function postHandler(request: Request, path: string[]) {
  await requireSameOrigin(request);
  const route = pathOf(path);
  if (route === '/demo/login') {
    assertSynthetic();
    const input = await body(request,z.object({accountId:uuid}));
    const allowed = new Set(['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005']);
    if (!allowed.has(input.accountId)) throw new AppError('demo_account_not_found',404);
    await createSession(input.accountId);
    return Response.json({ok:true});
  }
  if (route === '/auth/start') {
    assertSynthetic();
    const input = await body(request,z.object({firstName:z.string().trim().min(1).max(80),lastName:z.string().trim().min(1).max(80),
      birthDate:date,phone:z.string().trim().optional(),channel:z.enum(['sms','email']).default('sms')}));
    const requestKey = hashToken(`${request.headers.get('x-forwarded-for') ?? 'local'}:${input.firstName.toLowerCase()}:${input.lastName.toLowerCase()}:${input.birthDate}`);
    const count = await query<{count:string}>(`SELECT count(*)::text AS count FROM app.verification_challenge WHERE practice_id=$1
      AND request_key=$2 AND created_at>now()-interval '1 hour'`,[practiceId(),requestKey]);
    if (Number(count.rows[0].count) >= 5) throw new AppError('rate_limited',429,'Please try later or call the practice.');
    const matches = await practiceSystem().matchPatients(practiceId(),input.firstName,input.lastName,input.birthDate);
    const narrowed = matches.length > 1 && input.phone ? matches.filter(p=>p.phone===input.phone) : matches;
    const patient = narrowed.length === 1 ? narrowed[0] : null;
    const destination = input.channel === 'sms' ? patient?.phone : patient?.email;
    const challengeId = randomUUID(); const code = String(randomInt(0,100_000_000)).padStart(8,'0');
    const secret = process.env.DEMO_CODE_SECRET ?? 'synthetic-only-local-secret';
    const codeHash = destination ? createHmac('sha256',secret).update(`${challengeId}:${code}`).digest('hex') : null;
    await transaction(async client => {
      await client.query(`INSERT INTO app.verification_challenge(id,practice_id,patient_id,channel,destination,code_hash,
        expires_at,request_key) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '10 minutes',$7)`,
        [challengeId,practiceId(),destination ? patient?.id : null,input.channel,destination ?? null,codeHash,requestKey]);
      if (destination) await client.query('INSERT INTO app.local_inbox(practice_id,channel,destination,body) VALUES ($1,$2,$3,$4)',
        [practiceId(),input.channel,destination,`Demo verification code: ${code}`]);
    });
    return Response.json({challengeId,message:'If the record can be verified, a code has been sent to the contact on file. Check the demo inbox.'});
  }
  if (route === '/auth/verify') {
    assertSynthetic();
    const input = await body(request,z.object({challengeId:uuid,code:z.string().regex(/^\d{8}$/)}));
    const secret = process.env.DEMO_CODE_SECRET ?? 'synthetic-only-local-secret';
    const candidateHash = createHmac('sha256',secret).update(`${input.challengeId}:${input.code}`).digest('hex');
    const accountId = await transaction(async client => {
      const result = await client.query(`SELECT * FROM app.verification_challenge WHERE id=$1 AND practice_id=$2 FOR UPDATE`,[input.challengeId,practiceId()]);
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date() || challenge.attempts >= 5) return null;
      await client.query('UPDATE app.verification_challenge SET attempts=attempts+1 WHERE id=$1',[input.challengeId]);
      if (!challenge.patient_id || !challenge.code_hash ||
        !timingSafeEqual(Buffer.from(challenge.code_hash,'hex'),Buffer.from(candidateHash,'hex'))) return null;
      await client.query('UPDATE app.verification_challenge SET consumed_at=now() WHERE id=$1',[input.challengeId]);
      const link = await client.query('SELECT account_id FROM app.patient_link WHERE practice_id=$1 AND patient_id=$2',[practiceId(),challenge.patient_id]);
      if (link.rows[0]) return String(link.rows[0].account_id);
      const patient = await practiceSystem().patient(practiceId(),challenge.patient_id);
      if (!patient) throw new AppError('invalid_code',400);
      const created = await client.query(`INSERT INTO app.account(practice_id,display_name,role) VALUES ($1,$2,'patient') RETURNING id`,
        [practiceId(),`${patient.first_name} ${patient.last_name}`]);
      await client.query('INSERT INTO app.patient_link(account_id,practice_id,patient_id) VALUES ($1,$2,$3)',
        [created.rows[0].id,practiceId(),challenge.patient_id]);
      return String(created.rows[0].id);
    });
    if (!accountId) throw new AppError('invalid_code',400,'The code could not be verified.');
    await createSession(accountId);
    return Response.json({ok:true});
  }
  const actor = await requireActor();
  if (route === '/logout') { await removeSession(); return Response.json({ok:true}); }
  if (route === '/intents') {
    const input = await body(request,z.object({patientId:uuid,appointmentTypeId:z.string(),slot,
      xrayPreference:z.enum(['yes','no','discuss']).nullable().optional(),sourceAppointmentId:uuid.optional()}));
    return Response.json(await createIntent(actor,input));
  }
  if (path[0] === 'intents' && path[2] === 'confirm' && path.length === 3) {
    const key = request.headers.get('idempotency-key') ?? '';
    const result = await confirmIntent(actor,uuid.parse(path[1]),key);
    return Response.json(result,{status:result.state==='reconciling'?202:200});
  }
  if (path[0] === 'appointments' && path[2] === 'cancel' && path.length === 3) {
    const key = request.headers.get('idempotency-key') ?? '';
    const result = await cancelAppointment(actor,uuid.parse(path[1]),key);
    return Response.json(result,{status:result.state==='reconciling'?202:200});
  }
  if (route === '/favorites') {
    requireRole(actor,['patient']);
    const input = await body(request,z.object({patientId:uuid,providerId:uuid,favorite:z.boolean()}));
    await assertPatientAccess(actor,input.patientId);
    const provider = await query('SELECT 1 FROM app.provider WHERE id=$1 AND practice_id=$2 AND active',[input.providerId,actor.practice_id]);
    if (!provider.rowCount) throw new AppError('provider_not_found',404);
    if (input.favorite) await query(`INSERT INTO app.provider_favorite(practice_id,patient_id,provider_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[actor.practice_id,input.patientId,input.providerId]);
    else await query('DELETE FROM app.provider_favorite WHERE practice_id=$1 AND patient_id=$2 AND provider_id=$3',
      [actor.practice_id,input.patientId,input.providerId]);
    await audit('favorite.update','provider',input.providerId,'succeeded',actor.id);
    return Response.json({ok:true});
  }
  if (route === '/feedback') {
    requireRole(actor,['patient']);
    const input = await body(request,z.object({patientId:uuid,appointmentId:uuid,providerId:uuid,
      stars:z.number().int().min(1).max(5),comment:z.string().trim().max(2000).nullable().optional()}));
    await assertPatientAccess(actor,input.patientId,'history');
    const appointment = await practiceSystem().appointment(actor.practice_id,input.appointmentId);
    if (!appointment || appointment.patient_id !== input.patientId || appointment.status !== 'completed' ||
      ![appointment.hygienist_id,appointment.dentist_id].includes(input.providerId)) throw new AppError('feedback_not_allowed',409);
    const result = await query(`INSERT INTO app.feedback(practice_id,patient_id,appointment_id,provider_id,stars,comment)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (practice_id,appointment_id,provider_id) DO NOTHING RETURNING id`,
      [actor.practice_id,input.patientId,input.appointmentId,input.providerId,input.stars,input.comment ?? null]);
    if (!result.rowCount) throw new AppError('feedback_exists',409);
    await audit('feedback.submit','feedback',result.rows[0].id,'succeeded',actor.id);
    return Response.json({id:result.rows[0].id});
  }
  if (route === '/record-requests') {
    requireRole(actor,['patient']);
    const input = await body(request,z.object({patientId:uuid}));
    await assertPatientAccess(actor,input.patientId,'history');
    const id=await transaction(async client=>{
      const result = await client.query(`INSERT INTO app.record_request(practice_id,patient_id,requested_by)
        VALUES ($1,$2,$3) RETURNING id`,[actor.practice_id,input.patientId,actor.id]);
      await client.query(`INSERT INTO app.review_task(practice_id,patient_id,kind,summary,target_id)
        VALUES ($1,$2,'record_request',$3,$4)`,[actor.practice_id,input.patientId,'Fulfill this patient record request.',result.rows[0].id]);
      await audit('record_request.create','record_request',result.rows[0].id,'succeeded',actor.id,client);
      return result.rows[0].id;
    });
    return Response.json({id,status:'open'});
  }
  if (path[0]==='admin'&&path[1]==='review'&&path[3]==='fulfill'&&path.length===4) {
    requireRole(actor,['admin','staff']);
    const taskId=uuid.parse(path[2]);
    await transaction(async client=>{
      const task=await client.query(`SELECT * FROM app.review_task WHERE id=$1 AND practice_id=$2 FOR UPDATE`,[taskId,actor.practice_id]);
      if(!task.rows[0]||task.rows[0].kind!=='record_request'||task.rows[0].status!=='open'||!task.rows[0].target_id) throw new AppError('review_task_not_found',404);
      await client.query("UPDATE app.record_request SET status='fulfilled' WHERE id=$1 AND practice_id=$2",[task.rows[0].target_id,actor.practice_id]);
      await client.query("UPDATE app.review_task SET status='resolved' WHERE id=$1",[taskId]);
      await audit('record_request.fulfill','record_request',task.rows[0].target_id,'succeeded',actor.id,client);
    });
    return Response.json({ok:true});
  }
  if (path[0] === 'treatment' && path[2] === 'request' && path.length === 3) {
    requireRole(actor,['patient']);
    if (process.env.FEATURE_TREATMENT_REQUESTS !== '1') throw new AppError('feature_disabled',409,'Treatment requests are not available yet.');
    const input = await body(request,z.object({patientId:uuid}));
    await assertPatientAccess(actor,input.patientId,'costs');
    const plan = (await practiceSystem().treatmentPlans(actor.practice_id,input.patientId)).find(p=>p.id===path[1]);
    if (!plan) throw new AppError('plan_not_found',404);
    const result = await query(`INSERT INTO app.review_task(practice_id,patient_id,kind,summary,target_id) VALUES ($1,$2,'treatment', $3,$4) RETURNING id`,
      [actor.practice_id,input.patientId,'Treatment plan requires estimate and scheduling review.',plan.id]);
    await audit('treatment.request','review_task',result.rows[0].id,'succeeded',actor.id);
    return Response.json({id:result.rows[0].id,status:'staff_review'});
  }
  if (route === '/dentist/duration') {
    requireRole(actor,['dentist']);
    const input=await body(request,z.object({visitId:uuid,durationMinutes:z.number().int().min(15).max(480),
      schedulingNotes:z.string().trim().max(1000).nullable().optional()}));
    const membership=await query<{provider_id:string}>('SELECT provider_id FROM app.account WHERE id=$1 AND practice_id=$2',[actor.id,actor.practice_id]);
    const providerId=membership.rows[0]?.provider_id;
    if(!providerId) throw new AppError('provider_not_linked',403);
    const plans=await practiceSystem().treatmentPlansForDentist(actor.practice_id,providerId);
    if(!plans.some(p=>p.visits.some(v=>v.id===input.visitId))) throw new AppError('visit_not_found',404);
    await transaction(async client=>{
      await client.query(`INSERT INTO app.treatment_duration_setting(practice_id,treatment_visit_id,dentist_id,duration_minutes,scheduling_notes)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (practice_id,treatment_visit_id)
        DO UPDATE SET duration_minutes=EXCLUDED.duration_minutes,scheduling_notes=EXCLUDED.scheduling_notes,approved_at=now()`,
        [actor.practice_id,input.visitId,providerId,input.durationMinutes,input.schedulingNotes??null]);
      await audit('treatment.duration.approve','treatment_visit',input.visitId,'succeeded',actor.id,client);
    });
    return Response.json({ok:true});
  }
  if (path[0]==='admin'&&path[1]==='guardian-grants'&&path[3]==='revoke'&&path.length===4) {
    requireRole(actor,['admin']);
    const grantId=uuid.parse(path[2]);
    await transaction(async client=>{
      const result=await client.query(`UPDATE app.guardian_grant SET revoked_at=now() WHERE id=$1 AND practice_id=$2
        AND revoked_at IS NULL RETURNING id`,[grantId,actor.practice_id]);
      if(!result.rowCount) throw new AppError('guardian_grant_not_found',404);
      await audit('guardian_grant.revoke','guardian_grant',grantId,'succeeded',actor.id,client);
    });
    return Response.json({ok:true});
  }
  if (route === '/admin/hours') {
    requireRole(actor,['admin']);
    const input = await body(request,z.object({providerId:uuid,weekdays:z.array(z.number().int().min(0).max(6)).max(7),
      start:wallClock,end:wallClock}));
    if (input.start >= input.end) throw new AppError('invalid_hours',400);
    await transaction(async client => {
      const provider = await client.query('SELECT 1 FROM app.provider WHERE id=$1 AND practice_id=$2',[input.providerId,actor.practice_id]);
      if (!provider.rowCount) throw new AppError('provider_not_found',404);
      await client.query('DELETE FROM app.provider_hours WHERE practice_id=$1 AND provider_id=$2',[actor.practice_id,input.providerId]);
      for (const weekday of new Set(input.weekdays)) await client.query(`INSERT INTO app.provider_hours(practice_id,provider_id,weekday,start_local,end_local)
        VALUES ($1,$2,$3,$4,$5)`,[actor.practice_id,input.providerId,weekday,input.start,input.end]);
      await client.query('UPDATE app.scheduling_rule_version SET version=version+1,changed_at=now() WHERE practice_id=$1',[actor.practice_id]);
      await audit('calendar.hours','provider',input.providerId,'succeeded',actor.id,client);
    });
    return Response.json({ok:true});
  }
  if (route === '/admin/exception') {
    requireRole(actor,['admin']);
    const input = await body(request,z.object({providerId:uuid,localDate:date,available:z.boolean(),start:wallClock.optional(),end:wallClock.optional()}));
    if(input.available && (!input.start || !input.end || input.start>=input.end)) throw new AppError('invalid_hours',400);
    const today = localDate(new Date(),'America/Los_Angeles'); const limit = new Date(`${today}T12:00:00Z`); limit.setUTCMonth(limit.getUTCMonth()+6);
    if (input.localDate < today || input.localDate > limit.toISOString().slice(0,10)) throw new AppError('date_out_of_range',400);
    await transaction(async client => {
      const provider = await client.query('SELECT 1 FROM app.provider WHERE id=$1 AND practice_id=$2',[input.providerId,actor.practice_id]);
      if (!provider.rowCount) throw new AppError('provider_not_found',404);
      await client.query(`INSERT INTO app.availability_exception(practice_id,provider_id,local_date,available,start_local,end_local)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (practice_id,provider_id,local_date)
        DO UPDATE SET available=EXCLUDED.available,start_local=EXCLUDED.start_local,end_local=EXCLUDED.end_local`,
        [actor.practice_id,input.providerId,input.localDate,input.available,input.available?input.start:null,input.available?input.end:null]);
      await client.query('UPDATE app.scheduling_rule_version SET version=version+1,changed_at=now() WHERE practice_id=$1',[actor.practice_id]);
      await audit('calendar.exception','provider',input.providerId,'succeeded',actor.id,client);
    });
    return Response.json({ok:true});
  }
  throw new AppError('not_found',404);
}

export async function GET(request: Request, context: Context) {
  try { return await getHandler(request,(await context.params).path); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try { return await postHandler(request,(await context.params).path); } catch (error) { return errorResponse(error); }
}
