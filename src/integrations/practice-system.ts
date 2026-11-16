export type PatientRecord = {
  id: string; first_name: string; last_name: string; birth_date: string;
  phone: string | null; email: string | null; recare_due: string | null; last_xray: string | null;
};
export type ExternalAppointment = {
  id: string; patient_id: string; appointment_type_id: string;
  starts_at: string; ends_at: string; hygienist_id: string | null;
  dentist_id: string | null; operatory_id: string; xray_preference: string | null;
  status: 'confirmed'|'cancelled'|'completed'; updated_at: string;
};
export type SlotResources = {
  startsAt: string; endsAt: string; hygienistId: string | null;
  dentistId: string | null; operatoryId: string;
};
export type ExternalWrite = SlotResources & {
  operationId: string; practiceId: string; patientId: string;
  appointmentTypeId: string; xrayPreference: 'yes'|'no'|'discuss'|null;
};
export type TreatmentPlan = {
  id: string; patient_id: string; diagnosing_dentist_id: string;
  title: string; status: string; visits: { id: string; sequence: number; description: string; dentist_duration_minutes: number | null }[];
};
export type Capabilities = { immediateBooking: boolean; safeMove: boolean; treatmentEstimates: boolean; temporaryHold: boolean };

export interface PracticeSystem {
  readonly capabilities: Capabilities;
  matchPatients(practiceId: string, firstName: string, lastName: string, birthDate: string): Promise<PatientRecord[]>;
  patient(practiceId: string, patientId: string): Promise<PatientRecord | null>;
  appointments(practiceId: string, from: string, to: string): Promise<ExternalAppointment[]>;
  patientAppointments(practiceId: string, patientId: string): Promise<ExternalAppointment[]>;
  appointment(practiceId: string, appointmentId: string): Promise<ExternalAppointment | null>;
  changedAppointments(practiceId: string, cursor: string | null): Promise<{appointments:ExternalAppointment[];nextCursor:string|null}>;
  treatmentPlans(practiceId: string, patientId: string): Promise<TreatmentPlan[]>;
  treatmentPlansForDentist(practiceId: string, dentistId: string): Promise<TreatmentPlan[]>;
  book(write: ExternalWrite): Promise<ExternalAppointment>;
  move(operationId: string, practiceId: string, appointmentId: string, slot: SlotResources): Promise<ExternalAppointment>;
  cancel(operationId: string, practiceId: string, appointmentId: string): Promise<ExternalAppointment>;
  findOperation(practiceId: string, operationId: string): Promise<ExternalAppointment | null>;
}
