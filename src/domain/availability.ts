import { query, practiceId } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { practiceSystem } from '@/integrations';
import { localDate, localToUtc, localWeekday, overlaps } from './time';
import type { ExternalAppointment, SlotResources } from '@/integrations/practice-system';

type Provider = { id: string; name: string; kind: 'dentist'|'hygienist'; color: string };
type Room = { id: string; name: string };
type Rule = { id: string; name: string; duration_minutes: number | null; requires_hygienist: boolean; requires_dentist: boolean; immediate_booking: boolean; intake_guidance: string | null };
export type Candidate = SlotResources & { ruleVersion: number; generatedAt: string };

export async function schedulingCatalog() {
  const p = practiceId();
  const [types, providers, rooms, version] = await Promise.all([
    query<Rule>('SELECT * FROM app.appointment_type WHERE practice_id=$1 ORDER BY name', [p]),
    query<Provider>('SELECT id,name,kind,color FROM app.provider WHERE practice_id=$1 AND active ORDER BY name', [p]),
    query<Room>('SELECT id,name FROM app.operatory WHERE practice_id=$1 AND active ORDER BY name', [p]),
    query<{ version: number }>('SELECT version FROM app.scheduling_rule_version WHERE practice_id=$1', [p]),
  ]);
  return { types: types.rows, providers: providers.rows, rooms: rooms.rows, ruleVersion: version.rows[0]?.version ?? 0 };
}

function dateRange(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError('invalid_date', 400);
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (!Number.isInteger(days) || days < 0 || days > 14) throw new AppError('invalid_date_range', 400, 'Choose up to 15 days.');
  return Array.from({ length: days + 1 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

function clockMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export async function searchAvailability(input: {
  appointmentTypeId: string; from: string; to: string; providerId?: string;
  excludeAppointmentId?: string; limit?: number;
}): Promise<Candidate[]> {
  const dates = dateRange(input.from, input.to);
  const p = practiceId();
  const catalog = await schedulingCatalog();
  const rule = catalog.types.find(t => t.id === input.appointmentTypeId);
  if (!rule) throw new AppError('appointment_type_not_found', 404);
  if (!rule.immediate_booking || !rule.duration_minutes) return [];
  const [hours, exceptions, providerEligible, roomEligible, location] = await Promise.all([
    query<{provider_id:string;weekday:number;start_local:string;end_local:string}>('SELECT provider_id,weekday,start_local::text,end_local::text FROM app.provider_hours WHERE practice_id=$1', [p]),
    query<{provider_id:string;local_date:string;available:boolean;start_local:string|null;end_local:string|null}>(`SELECT provider_id,local_date::text,available,start_local::text,end_local::text FROM app.availability_exception
      WHERE practice_id=$1 AND local_date BETWEEN $2 AND $3`, [p, input.from, input.to]),
    query<{provider_id:string}>('SELECT provider_id FROM app.provider_type_eligibility WHERE practice_id=$1 AND appointment_type_id=$2', [p, rule.id]),
    query<{operatory_id:string}>('SELECT operatory_id FROM app.operatory_type_eligibility WHERE practice_id=$1 AND appointment_type_id=$2', [p, rule.id]),
    query<{timezone:string}>('SELECT timezone FROM app.location WHERE practice_id=$1 ORDER BY id LIMIT 1', [p]),
  ]);
  const timezone = location.rows[0]?.timezone ?? 'America/Los_Angeles';
  const external = practiceSystem();
  const appointments = await external.appointments(p, new Date(`${input.from}T00:00:00Z`).toISOString(), new Date(new Date(`${input.to}T00:00:00Z`).getTime() + 2 * 86_400_000).toISOString());
  const occupied = appointments.filter(a => a.id !== input.excludeAppointmentId);
  const eligibleProviders = new Set(providerEligible.rows.map(e => e.provider_id));
  const eligibleRooms = new Set(roomEligible.rows.map(e => e.operatory_id));
  const hygienists = rule.requires_hygienist ? catalog.providers.filter(v => v.kind === 'hygienist' && eligibleProviders.has(v.id)) : [null];
  const dentists = rule.requires_dentist ? catalog.providers.filter(v => v.kind === 'dentist' && eligibleProviders.has(v.id)) : [null];
  const rooms = catalog.rooms.filter(r => eligibleRooms.has(r.id));
  const generatedAt = new Date().toISOString();
  const candidates: Candidate[] = [];
  const limit = Math.min(input.limit ?? 100, 2000);

  function works(provider: Provider | null, date: string, fromMinutes: number, toMinutes: number) {
    if (!provider) return true;
    const exception = exceptions.rows.find(e => e.provider_id === provider.id && e.local_date === date);
    if (exception) return exception.available && fromMinutes >= clockMinutes(exception.start_local!) && toMinutes <= clockMinutes(exception.end_local!);
    const regular = hours.rows.find(h => h.provider_id === provider.id && Number(h.weekday) === localWeekday(date));
    return !!regular && fromMinutes >= clockMinutes(regular.start_local) && toMinutes <= clockMinutes(regular.end_local);
  }
  function free(resourceIds: (string | null)[], start: Date, end: Date, appointment: ExternalAppointment) {
    return overlaps(start, end, new Date(appointment.starts_at), new Date(appointment.ends_at)) &&
      resourceIds.some(id => id && [appointment.hygienist_id, appointment.dentist_id, appointment.operatory_id].includes(id));
  }
  for (const date of dates) {
    const [year, month, day] = date.split('-').map(Number);
    for (let minute = 7 * 60; minute + rule.duration_minutes <= 19 * 60; minute += 15) {
      const start = localToUtc({year,month,day,hour:Math.floor(minute/60),minute:minute%60}, timezone);
      const endMinute = minute + rule.duration_minutes;
      const end = localToUtc({year,month,day,hour:Math.floor(endMinute/60),minute:endMinute%60}, timezone);
      if (!start || !end || end <= start || start <= new Date()) continue;
      combination: for (const hygienist of hygienists) for (const dentist of dentists) {
        if (input.providerId && input.providerId !== hygienist?.id && input.providerId !== dentist?.id) continue;
        if (!works(hygienist, date, minute, endMinute) || !works(dentist, date, minute, endMinute)) continue;
        for (const room of rooms) {
          if (occupied.some(a => free([hygienist?.id ?? null,dentist?.id ?? null,room.id],start,end,a))) continue;
          candidates.push({startsAt:start.toISOString(), endsAt:end.toISOString(), hygienistId:hygienist?.id ?? null,
            dentistId:dentist?.id ?? null,operatoryId:room.id,ruleVersion:catalog.ruleVersion,generatedAt});
          if (candidates.length >= limit) return candidates;
          break combination;
        }
      }
    }
  }
  return candidates;
}

export async function validateCandidate(input: {
  appointmentTypeId: string; startsAt: string; endsAt: string;
  hygienistId: string | null; dentistId: string | null; operatoryId: string;
  ruleVersion: number; excludeAppointmentId?: string;
}) {
  const current = await schedulingCatalog();
  if (input.ruleVersion !== current.ruleVersion) throw new AppError('rules_changed', 409, 'Scheduling rules changed. Please choose a new time.');
  const timezone = (await query<{timezone:string}>('SELECT timezone FROM app.location WHERE practice_id=$1 ORDER BY id LIMIT 1',[practiceId()])).rows[0]?.timezone ?? 'America/Los_Angeles';
  const local = localDate(new Date(input.startsAt), timezone);
  const slots = await searchAvailability({appointmentTypeId:input.appointmentTypeId,from:local,to:local,
    excludeAppointmentId:input.excludeAppointmentId,limit:2000});
  if (!slots.some(s => s.startsAt === input.startsAt && s.endsAt === input.endsAt && s.hygienistId === input.hygienistId &&
    s.dentistId === input.dentistId && s.operatoryId === input.operatoryId)) {
    throw new AppError('slot_unavailable', 409, 'This time is no longer available.');
  }
}
