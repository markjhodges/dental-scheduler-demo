CREATE TABLE app.coverage_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL, source text NOT NULL, checked_at timestamptz NOT NULL,
  valid_until timestamptz, status text NOT NULL CHECK (status IN ('supported','unknown','unavailable')),
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE app.cost_estimate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL, treatment_plan_id uuid, appointment_type_id text,
  coverage_check_id uuid REFERENCES app.coverage_check(id), source text NOT NULL,
  calculated_at timestamptz NOT NULL, valid_until timestamptz,
  currency char(3) NOT NULL DEFAULT 'USD', total_minor int, insurance_minor int, patient_minor int,
  display_approved boolean NOT NULL DEFAULT false, disclaimer text NOT NULL,
  CHECK (total_minor IS NULL OR total_minor >= 0), CHECK (insurance_minor IS NULL OR insurance_minor >= 0),
  CHECK (patient_minor IS NULL OR patient_minor >= 0)
);
CREATE TABLE app.intake_requirement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  appointment_type_id text NOT NULL REFERENCES app.appointment_type(id),
  title text NOT NULL, instructions text NOT NULL, active boolean NOT NULL DEFAULT false
);
CREATE TABLE app.intake_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practice_id uuid NOT NULL REFERENCES app.practice(id),
  patient_id uuid NOT NULL, requirement_id uuid NOT NULL REFERENCES app.intake_requirement(id),
  status text NOT NULL CHECK (status IN ('pending','received','rejected')),
  private_object_key text, submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.treatment_duration_setting (
  practice_id uuid NOT NULL REFERENCES app.practice(id), treatment_visit_id uuid NOT NULL,
  dentist_id uuid NOT NULL REFERENCES app.provider(id), duration_minutes int NOT NULL CHECK (duration_minutes>0),
  scheduling_notes text, approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(practice_id,treatment_visit_id)
);
CREATE TABLE app.visit_dependency (
  practice_id uuid NOT NULL REFERENCES app.practice(id), prior_visit_id uuid NOT NULL,
  next_visit_id uuid NOT NULL, min_gap_minutes int NOT NULL CHECK (min_gap_minutes>=0),
  max_gap_minutes int CHECK (max_gap_minutes IS NULL OR max_gap_minutes>=min_gap_minutes),
  PRIMARY KEY(practice_id,prior_visit_id,next_visit_id)
);
