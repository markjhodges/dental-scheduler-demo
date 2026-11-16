-- Illustrative patient overview data. These dates are not verified benefits or clinical advice.
CREATE TABLE simulator.recare_schedule (
  patient_id uuid PRIMARY KEY REFERENCES simulator.patient(id),
  practice_id uuid NOT NULL REFERENCES app.practice(id),
  insurance_name text
);

CREATE TABLE simulator.recare_milestone (
  patient_id uuid NOT NULL REFERENCES simulator.patient(id),
  procedure_key text NOT NULL,
  procedure_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('routine','imaging')),
  last_completed_on date,
  due_on date,
  sort_order int NOT NULL,
  PRIMARY KEY (patient_id, procedure_key),
  CHECK (due_on IS NULL OR last_completed_on IS NULL OR due_on > last_completed_on)
);

CREATE TABLE simulator.appointment_procedure (
  appointment_id uuid NOT NULL REFERENCES simulator.appointment(id) ON DELETE CASCADE,
  procedure_name text NOT NULL,
  sort_order int NOT NULL,
  PRIMARY KEY (appointment_id, sort_order)
);

INSERT INTO simulator.recare_schedule(patient_id,practice_id,insurance_name) VALUES
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Delta Dental Premier'),
 ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',NULL),
 ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Delta Dental Premier');

INSERT INTO simulator.recare_milestone(patient_id,procedure_key,procedure_name,category,last_completed_on,due_on,sort_order) VALUES
 ('20000000-0000-4000-8000-000000000001','cleaning','Cleaning','routine',CURRENT_DATE-90,CURRENT_DATE+45,1),
 ('20000000-0000-4000-8000-000000000001','exam','Exam','routine',CURRENT_DATE-90,CURRENT_DATE+45,2),
 ('20000000-0000-4000-8000-000000000001','bitewing','Bitewing X-rays','imaging',CURRENT_DATE-300,CURRENT_DATE+65,3),
 ('20000000-0000-4000-8000-000000000001','periapical','Periapical X-rays','imaging',CURRENT_DATE-400,CURRENT_DATE+330,4),
 ('20000000-0000-4000-8000-000000000001','panoramic','Panoramic X-ray','imaging',CURRENT_DATE-700,CURRENT_DATE-15,5),
 ('20000000-0000-4000-8000-000000000001','full-mouth','Full-mouth series','imaging',NULL,NULL,6),
 ('20000000-0000-4000-8000-000000000002','cleaning','Cleaning','routine',NULL,NULL,1),
 ('20000000-0000-4000-8000-000000000002','exam','Exam','routine',NULL,NULL,2),
 ('20000000-0000-4000-8000-000000000002','bitewing','Bitewing X-rays','imaging',NULL,NULL,3),
 ('20000000-0000-4000-8000-000000000002','periapical','Periapical X-rays','imaging',NULL,NULL,4),
 ('20000000-0000-4000-8000-000000000002','panoramic','Panoramic X-ray','imaging',NULL,NULL,5),
 ('20000000-0000-4000-8000-000000000002','full-mouth','Full-mouth series','imaging',NULL,NULL,6),
 ('20000000-0000-4000-8000-000000000003','cleaning','Cleaning','routine',CURRENT_DATE-95,CURRENT_DATE+90,1),
 ('20000000-0000-4000-8000-000000000003','exam','Exam','routine',CURRENT_DATE-95,CURRENT_DATE+90,2),
 ('20000000-0000-4000-8000-000000000003','bitewing','Bitewing X-rays','imaging',NULL,NULL,3),
 ('20000000-0000-4000-8000-000000000003','periapical','Periapical X-rays','imaging',NULL,NULL,4),
 ('20000000-0000-4000-8000-000000000003','panoramic','Panoramic X-ray','imaging',NULL,NULL,5),
 ('20000000-0000-4000-8000-000000000003','full-mouth','Full-mouth series','imaging',NULL,NULL,6);

INSERT INTO simulator.appointment_procedure(appointment_id,procedure_name,sort_order) VALUES
 ('50000000-0000-4000-8000-000000000001','Adult cleaning',1),
 ('50000000-0000-4000-8000-000000000001','Periodic exam',2);
