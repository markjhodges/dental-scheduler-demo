CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS simulator;

CREATE TABLE app.practice (
  id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.location (
  id uuid PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id),
  name text NOT NULL, timezone text NOT NULL DEFAULT 'America/Los_Angeles'
);
CREATE TABLE app.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  display_name text NOT NULL, role text NOT NULL CHECK (role IN ('patient','staff','dentist','admin')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.patient_link (
  account_id uuid NOT NULL REFERENCES app.account(id), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, patient_id), UNIQUE (practice_id, patient_id)
);
CREATE TABLE app.guardian_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  account_id uuid NOT NULL REFERENCES app.account(id), patient_id uuid NOT NULL,
  scope text[] NOT NULL, evidence_ref text NOT NULL, expires_at timestamptz,
  revoked_at timestamptz, reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, account_id, patient_id)
);
CREATE TABLE app.session (
  token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES app.account(id),
  practice_id uuid NOT NULL REFERENCES app.practice(id), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.verification_challenge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid, channel text CHECK (channel IN ('sms','email')),
  destination text, code_hash text, attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL, consumed_at timestamptz,
  request_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX challenge_rate ON app.verification_challenge(practice_id, request_key, created_at DESC);

CREATE TABLE app.provider (
  id uuid PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id),
  name text NOT NULL, kind text NOT NULL CHECK (kind IN ('hygienist','dentist')),
  color text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE app.operatory (
  id uuid PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id),
  location_id uuid NOT NULL REFERENCES app.location(id), name text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE app.appointment_type (
  id text PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id), name text NOT NULL,
  duration_minutes int CHECK (duration_minutes > 0),
  requires_hygienist boolean NOT NULL, requires_dentist boolean NOT NULL,
  immediate_booking boolean NOT NULL DEFAULT false,
  intake_guidance text,
  CHECK (NOT immediate_booking OR duration_minutes IS NOT NULL)
);
CREATE TABLE app.scheduling_rule_version (
  practice_id uuid PRIMARY KEY REFERENCES app.practice(id), version int NOT NULL DEFAULT 1,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.provider_hours (
  practice_id uuid NOT NULL REFERENCES app.practice(id), provider_id uuid NOT NULL REFERENCES app.provider(id),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_local time NOT NULL, end_local time NOT NULL,
  CHECK (start_local < end_local), PRIMARY KEY (practice_id, provider_id, weekday)
);
CREATE TABLE app.availability_exception (
  practice_id uuid NOT NULL REFERENCES app.practice(id), provider_id uuid NOT NULL REFERENCES app.provider(id),
  local_date date NOT NULL, available boolean NOT NULL,
  start_local time, end_local time,
  CHECK (NOT available OR (start_local IS NOT NULL AND end_local IS NOT NULL AND start_local < end_local)),
  PRIMARY KEY (practice_id, provider_id, local_date)
);
CREATE TABLE app.provider_type_eligibility (
  practice_id uuid NOT NULL REFERENCES app.practice(id), provider_id uuid NOT NULL REFERENCES app.provider(id),
  appointment_type_id text NOT NULL REFERENCES app.appointment_type(id),
  PRIMARY KEY (practice_id, provider_id, appointment_type_id)
);
CREATE TABLE app.operatory_type_eligibility (
  practice_id uuid NOT NULL REFERENCES app.practice(id), operatory_id uuid NOT NULL REFERENCES app.operatory(id),
  appointment_type_id text NOT NULL REFERENCES app.appointment_type(id),
  PRIMARY KEY (practice_id, operatory_id, appointment_type_id)
);

CREATE TABLE app.booking_intent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  actor_id uuid NOT NULL REFERENCES app.account(id), patient_id uuid NOT NULL,
  appointment_type_id text NOT NULL REFERENCES app.appointment_type(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  hygienist_id uuid REFERENCES app.provider(id), dentist_id uuid REFERENCES app.provider(id),
  operatory_id uuid NOT NULL REFERENCES app.operatory(id), rule_version int NOT NULL,
  xray_preference text CHECK (xray_preference IN ('yes','no','discuss')),
  expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','expired','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.booking_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  actor_id uuid NOT NULL REFERENCES app.account(id), command text NOT NULL CHECK (command IN ('book','move','cancel')),
  idempotency_key text NOT NULL, payload_hash text NOT NULL,
  intent_id uuid REFERENCES app.booking_intent(id), appointment_id uuid,
  state text NOT NULL CHECK (state IN ('pending','submitting','succeeded','rejected','reconciling')),
  result jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, actor_id, command, idempotency_key)
);
CREATE INDEX booking_operation_reconcile ON app.booking_operation(state, updated_at);
CREATE TABLE app.appointment_projection (
  id uuid PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id), patient_id uuid NOT NULL,
  appointment_type_id text NOT NULL REFERENCES app.appointment_type(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  hygienist_id uuid, dentist_id uuid, operatory_id uuid,
  status text NOT NULL CHECK (status IN ('confirmed','cancelled','completed')),
  xray_preference text, source_updated_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_patient ON app.appointment_projection(practice_id, patient_id, starts_at);
CREATE TABLE app.review_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL, kind text NOT NULL, summary text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.provider_favorite (
  practice_id uuid NOT NULL REFERENCES app.practice(id), patient_id uuid NOT NULL,
  provider_id uuid NOT NULL REFERENCES app.provider(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, patient_id, provider_id)
);
CREATE TABLE app.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL, appointment_id uuid NOT NULL REFERENCES app.appointment_projection(id),
  provider_id uuid NOT NULL REFERENCES app.provider(id), stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, appointment_id, provider_id)
);
CREATE TABLE app.record_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL, requested_by uuid NOT NULL REFERENCES app.account(id),
  status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id),
  actor_id uuid, action text NOT NULL, target_type text NOT NULL, target_id text,
  outcome text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.outbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  event_type text NOT NULL, dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL,
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz, failed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.local_inbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id),
  channel text NOT NULL, destination text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.external_mapping (
  practice_id uuid NOT NULL REFERENCES app.practice(id), entity_type text NOT NULL,
  local_id uuid NOT NULL, external_id text NOT NULL, PRIMARY KEY (practice_id, entity_type, local_id),
  UNIQUE (practice_id, entity_type, external_id)
);
CREATE TABLE app.sync_checkpoint (
  practice_id uuid NOT NULL REFERENCES app.practice(id), stream text NOT NULL,
  cursor text, synced_at timestamptz, PRIMARY KEY (practice_id, stream)
);

CREATE TABLE simulator.patient (
  id uuid PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id),
  first_name text NOT NULL, last_name text NOT NULL, birth_date date NOT NULL,
  phone text, email text, recare_due date, last_xray date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_match ON simulator.patient(practice_id, lower(first_name), lower(last_name), birth_date);
CREATE TABLE simulator.appointment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL REFERENCES simulator.patient(id), appointment_type_id text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  hygienist_id uuid, dentist_id uuid, operatory_id uuid NOT NULL,
  xray_preference text, status text NOT NULL CHECK (status IN ('confirmed','cancelled','completed')),
  operation_id uuid UNIQUE, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE simulator.allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_id uuid NOT NULL REFERENCES simulator.appointment(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES app.practice(id), resource_id uuid NOT NULL,
  during tstzrange NOT NULL, EXCLUDE USING gist (practice_id WITH =, resource_id WITH =, during WITH &&)
);
CREATE INDEX simulator_appointment_patient ON simulator.appointment(practice_id, patient_id, starts_at);
CREATE TABLE simulator.treatment_plan (
  id uuid PRIMARY KEY, practice_id uuid NOT NULL REFERENCES app.practice(id), patient_id uuid NOT NULL REFERENCES simulator.patient(id),
  diagnosing_dentist_id uuid NOT NULL REFERENCES app.provider(id), title text NOT NULL,
  status text NOT NULL DEFAULT 'proposed', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE simulator.treatment_visit (
  id uuid PRIMARY KEY, plan_id uuid NOT NULL REFERENCES simulator.treatment_plan(id),
  sequence int NOT NULL, description text NOT NULL, dentist_duration_minutes int,
  min_gap_minutes int, max_gap_minutes int, UNIQUE (plan_id, sequence)
);
