INSERT INTO app.account(id,practice_id,display_name,role,provider_id) VALUES
 ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','Dr. Avery Lin','dentist','30000000-0000-4000-8000-000000000001');
INSERT INTO app.provider(id,practice_id,name,kind,color,active) VALUES
 ('30000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','Dr. Blake Gray','dentist','#7b8490',false);
INSERT INTO simulator.treatment_plan(id,practice_id,patient_id,diagnosing_dentist_id,title) VALUES
 ('60000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000005','Filling assessment');
INSERT INTO simulator.treatment_visit(id,plan_id,sequence,description,dentist_duration_minutes) VALUES
 ('61000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000002',1,'Dentist review and filling',NULL);
INSERT INTO app.availability_exception(practice_id,provider_id,local_date,available) VALUES
 ('00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',CURRENT_DATE + 21,false);
