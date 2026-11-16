-- Fictional records only. This migration is refused outside APP_MODE=synthetic.
INSERT INTO app.practice(id,name) VALUES ('00000000-0000-4000-8000-000000000001','Cypress Demo Dental');
INSERT INTO app.location(id,practice_id,name,timezone) VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','Main office','America/Los_Angeles');
INSERT INTO app.scheduling_rule_version(practice_id) VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO app.account(id,practice_id,display_name,role) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Morgan Example','patient'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Taylor Example','patient'),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Practice Owner','admin'),
 ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','Front Desk','staff');
INSERT INTO simulator.patient(id,practice_id,first_name,last_name,birth_date,phone,email,recare_due,last_xray) VALUES
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Morgan','Example','1988-04-12','555-0101','morgan@example.com',CURRENT_DATE + 45,CURRENT_DATE - 700),
 ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Taylor','Example','1989-08-03','555-0101','taylor@example.com',NULL,NULL),
 ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Casey','Example','2018-05-20','555-0101',NULL,CURRENT_DATE + 90,NULL),
 ('20000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','Jordan','Duplicate','1990-09-09','555-0104','jordan1@example.com',NULL,NULL),
 ('20000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','Jordan','Duplicate','1990-09-09','555-0105','jordan2@example.com',NULL,NULL);
INSERT INTO app.patient_link(account_id,practice_id,patient_id) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
INSERT INTO app.guardian_grant(practice_id,account_id,patient_id,scope,evidence_ref) VALUES
 ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',ARRAY['appointments','history','costs'],'DEMO-STAFF-REVIEW');
INSERT INTO app.provider(id,practice_id,name,kind,color) VALUES
 ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Dr. Avery Lin','dentist','#6957c5'),
 ('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Dr. Rowan Patel','dentist','#b45a72'),
 ('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Sam Rivera, RDH','hygienist','#2c8b83'),
 ('30000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','Alex Chen, RDH','hygienist','#b28128');
INSERT INTO app.operatory(id,practice_id,location_id,name) VALUES
 ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Room 1'),
 ('40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Room 2'),
 ('40000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','Room 3');
INSERT INTO app.appointment_type(id,practice_id,name,duration_minutes,requires_hygienist,requires_dentist,immediate_booking,intake_guidance) VALUES
 ('adult-cleaning','00000000-0000-4000-8000-000000000001','Adult cleaning and exam',60,true,true,true,NULL),
 ('child-cleaning','00000000-0000-4000-8000-000000000001','Child cleaning and exam',30,true,true,true,NULL),
 ('new-patient-exam','00000000-0000-4000-8000-000000000001','New patient exam and cleaning',90,true,true,true,'The practice will confirm which intake forms and prior records are needed before your visit.'),
 ('periodic-exam','00000000-0000-4000-8000-000000000001','Periodic exam',NULL,false,true,false,NULL),
 ('filling','00000000-0000-4000-8000-000000000001','Filling',NULL,false,true,false,NULL),
 ('crown','00000000-0000-4000-8000-000000000001','Crown',NULL,false,true,false,NULL);
INSERT INTO app.provider_hours(practice_id,provider_id,weekday,start_local,end_local)
 SELECT '00000000-0000-4000-8000-000000000001',p.id,d.weekday,'09:00','17:00'
 FROM app.provider p CROSS JOIN (VALUES (1),(2),(3),(4),(5)) d(weekday);
INSERT INTO app.provider_type_eligibility(practice_id,provider_id,appointment_type_id)
 SELECT '00000000-0000-4000-8000-000000000001',p.id,t.id FROM app.provider p CROSS JOIN app.appointment_type t
 WHERE (p.kind='hygienist' AND t.requires_hygienist) OR (p.kind='dentist' AND t.requires_dentist);
INSERT INTO app.operatory_type_eligibility(practice_id,operatory_id,appointment_type_id)
 SELECT '00000000-0000-4000-8000-000000000001',o.id,t.id FROM app.operatory o CROSS JOIN app.appointment_type t
 WHERE t.immediate_booking;
INSERT INTO simulator.appointment(id,practice_id,patient_id,appointment_type_id,starts_at,ends_at,hygienist_id,dentist_id,operatory_id,status) VALUES
 ('50000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','adult-cleaning',now()-interval '90 days',now()-interval '90 days'+interval '1 hour','30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','completed'),
 ('50000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','adult-cleaning',now()+interval '14 days',now()+interval '14 days'+interval '1 hour','30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','confirmed');
INSERT INTO simulator.allocation(appointment_id,practice_id,resource_id,during)
 SELECT a.id,a.practice_id,r.id,tstzrange(a.starts_at,a.ends_at,'[)')
 FROM simulator.appointment a CROSS JOIN LATERAL (VALUES (a.hygienist_id),(a.dentist_id),(a.operatory_id)) r(id)
 WHERE r.id IS NOT NULL AND a.status='confirmed';
INSERT INTO app.appointment_projection(id,practice_id,patient_id,appointment_type_id,starts_at,ends_at,hygienist_id,dentist_id,operatory_id,status,source_updated_at)
 SELECT id,practice_id,patient_id,appointment_type_id,starts_at,ends_at,hygienist_id,dentist_id,operatory_id,status,updated_at FROM simulator.appointment;
INSERT INTO simulator.treatment_plan(id,practice_id,patient_id,diagnosing_dentist_id,title) VALUES
 ('60000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Crown restoration');
INSERT INTO simulator.treatment_visit(id,plan_id,sequence,description,dentist_duration_minutes) VALUES
 ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',1,'Preparation visit',NULL),
 ('61000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',2,'Placement visit',NULL);
