import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { query, practiceId, transaction } from './db';
import { AppError } from './errors';
import { audit } from './audit';

export type Actor = { id: string; practice_id: string; display_name: string; role: 'patient'|'staff'|'dentist'|'admin' };
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get('dental_session')?.value;
  if (!token) return null;
  const result = await query<Actor>(`SELECT a.id,a.practice_id,a.display_name,a.role FROM app.session s
    JOIN app.account a ON a.id=s.account_id AND a.practice_id=s.practice_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active AND a.practice_id=$2`, [hashToken(token), practiceId()]);
  return result.rows[0] ?? null;
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new AppError('unauthorized', 401, 'Please sign in.');
  return actor;
}

export function requireRole(actor: Actor, roles: Actor['role'][]) {
  if (!roles.includes(actor.role)) throw new AppError('forbidden', 403, 'You do not have access to this action.');
}

export async function canAccessPatient(actor: Actor, patientId: string, scope: 'appointments'|'history'|'costs' = 'appointments') {
  if (actor.role === 'admin' || actor.role === 'staff') return true;
  const result = await query(`SELECT 1 FROM app.patient_link WHERE practice_id=$1 AND account_id=$2 AND patient_id=$3
    UNION ALL SELECT 1 FROM app.guardian_grant WHERE practice_id=$1 AND account_id=$2 AND patient_id=$3
    AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND $4=ANY(scope) LIMIT 1`,
    [actor.practice_id, actor.id, patientId, scope]);
  return result.rowCount !== null && result.rowCount > 0;
}

export async function assertPatientAccess(actor: Actor, patientId: string, scope: 'appointments'|'history'|'costs' = 'appointments') {
  if (!(await canAccessPatient(actor, patientId, scope))) {
    await audit('patient.access', 'patient', patientId, 'denied', actor.id);
    throw new AppError('forbidden', 403, 'You do not have access to this patient.');
  }
}

export async function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = process.env.APP_ORIGIN;
  if (!origin || !expected || origin !== expected) throw new AppError('invalid_origin', 403, 'Request origin was not accepted.');
}

export async function createSession(accountId: string) {
  const token = randomBytes(32).toString('base64url');
  await transaction(async client => {
    const account = await client.query('SELECT id FROM app.account WHERE id=$1 AND practice_id=$2 AND active', [accountId, practiceId()]);
    if (!account.rowCount) throw new AppError('account_unavailable', 403);
    await client.query('INSERT INTO app.session(token_hash,account_id,practice_id,expires_at) VALUES ($1,$2,$3,now()+interval \'12 hours\')', [hashToken(token), accountId, practiceId()]);
    await audit('session.create','account',accountId,'succeeded',accountId,client);
  });
  (await cookies()).set('dental_session', token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
    path: '/', maxAge: 12 * 60 * 60,
  });
}

export async function removeSession() {
  const token = (await cookies()).get('dental_session')?.value;
  if (token) await query('DELETE FROM app.session WHERE token_hash=$1', [hashToken(token)]);
  (await cookies()).delete('dental_session');
}
