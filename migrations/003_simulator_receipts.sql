CREATE TABLE simulator.operation_receipt (
  operation_id uuid PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES app.practice(id),
  appointment_id uuid NOT NULL REFERENCES simulator.appointment(id),
  command text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
