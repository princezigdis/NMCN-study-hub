-- =====================================================================
-- DEMONSTRATION CONTENT — for local development and staging ONLY.
-- Every row is flagged is_demo = true and titled "(Demo)". It is NOT
-- verified NMCN material. Do not load this into production; or archive it
-- from the admin dashboard before launch.
-- =====================================================================
begin;
set search_path = public, extensions;

create or replace function pg_temp.q(
  p_bank public.question_bank, p_topic uuid, p_course uuid, p_stem text, p_diff public.difficulty_level,
  p_correct text, a text, ra text, b text, rb text, c text, rc text, d text, rd text, p_source text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.questions(bank, topic_id, course_id, stem, difficulty, status, source_reference, is_demo, tags)
  values (p_bank, p_topic, p_course, p_stem, p_diff, 'published', p_source, true, array['demo'])
  returning id into v;
  insert into public.question_options(question_id, label, body, is_correct, rationale, position) values
    (v, 'A', a, p_correct = 'A', ra, 1), (v, 'B', b, p_correct = 'B', rb, 2),
    (v, 'C', c, p_correct = 'C', rc, 3), (v, 'D', d, p_correct = 'D', rd, 4);
  insert into public.question_programmes(question_id, programme_id) select v, id from public.programmes;
  return v;
end $$;

do $$
declare
  c_fund uuid; c_mid uuid; m1 uuid; m2 uuid; t_vitals uuid; t_ipc uuid; t_labour uuid;
  n1 uuid; n2 uuid; v1 uuid; v2 uuid;
  pool_c uuid; pool_d uuid; cfg_c uuid; cfg_d uuid; paper uuid; st_c uuid; st_p uuid; qid uuid;
  rn uuid := (select id from public.programmes where code = 'RN');
  rm uuid := (select id from public.programmes where code = 'RM');
begin
  -- ---------- Curriculum skeleton ----------
  insert into public.curriculum_versions(programme_id, label, source, status)
  values (rn, 'RN Demo Curriculum', 'Placeholder — replace with the official NMCN curriculum', 'published'),
         (rm, 'RM Demo Curriculum', 'Placeholder — replace with the official NMCN curriculum', 'published')
  on conflict do nothing;

  insert into public.courses(code, title, description, level, position, status, is_demo, source)
  values ('DEMO-FON', 'Foundations of Nursing Practice (Demo)', 'Demonstration course showing how the library works.',
          'Year 1', 1, 'published', true, 'Demo content')
  returning id into c_fund;
  insert into public.courses(code, title, description, level, position, status, is_demo, source)
  values ('DEMO-MID', 'Intrapartum Care (Demo)', 'Demonstration midwifery course.', 'Year 1', 2, 'published', true, 'Demo content')
  returning id into c_mid;
  insert into public.course_programmes(course_id, programme_id) values (c_fund, rn), (c_fund, rm), (c_mid, rm);

  insert into public.modules(course_id, title, position, status) values (c_fund, 'Basic Clinical Skills', 1, 'published') returning id into m1;
  insert into public.modules(course_id, title, position, status) values (c_mid, 'Labour and Birth', 1, 'published') returning id into m2;
  insert into public.topics(module_id, title, summary, position, status)
    values (m1, 'Vital Signs', 'Measuring and interpreting temperature, pulse, respiration and blood pressure.', 1, 'published')
    returning id into t_vitals;
  insert into public.topics(module_id, title, summary, position, status)
    values (m1, 'Infection Prevention and Control', 'Hand hygiene, PPE and standard precautions.', 2, 'published')
    returning id into t_ipc;
  insert into public.topics(module_id, title, summary, position, status)
    values (m2, 'Stages of Labour', 'Definitions and care in each stage of labour.', 1, 'published')
    returning id into t_labour;

  -- ---------- Notes (published v1) ----------
  insert into public.notes(topic_id, title, position, status, is_demo) values (t_vitals, 'Vital Signs — Overview (Demo)', 1, 'draft', true) returning id into n1;
  insert into public.note_versions(note_id, version, status, source_reference, body_md) values (n1, 1, 'approved',
    'Demo content — replace with reviewed material',
$md$> **Demonstration content.** This note shows how the library renders. It is not verified NMCN material.

## What are vital signs?
Vital signs are objective measurements of essential physiological functions:

| Sign | Typical adult resting range | Key points |
|---|---|---|
| Temperature | about 36.5–37.5 °C | Site matters: rectal readings run higher than axillary |
| Pulse | 60–100 beats/min | Count for 60 seconds if irregular |
| Respiration | 12–20 breaths/min | Count without telling the patient, so breathing stays natural |
| Blood pressure | below 120/80 mmHg is optimal | Use the correct cuff size |

## Good practice
1. Explain the procedure and gain consent.
2. Perform hand hygiene.
3. Measure, **record immediately**, and compare with previous readings.
4. Report abnormal findings promptly and follow local early-warning-score escalation.

## Common errors
- A cuff that is **too small** gives a falsely **high** blood pressure; too large gives a falsely low reading.
- Counting the pulse for 15 seconds and multiplying by 4 can miss irregular rhythms.
$md$) returning id into v1;
  update public.notes set current_version_id = v1, status = 'published' where id = n1;
  insert into public.note_references(note_id, citation, position) values
    (n1, 'Demo reference placeholder — add the textbook or guideline used by your reviewer', 1);

  insert into public.notes(topic_id, title, position, status, is_demo) values (t_ipc, 'Hand Hygiene and PPE (Demo)', 1, 'draft', true) returning id into n2;
  insert into public.note_versions(note_id, version, status, source_reference, body_md) values (n2, 1, 'approved',
    'WHO Guidelines on Hand Hygiene in Health Care (2009) — summary for demo',
$md$> **Demonstration content.** Not verified NMCN material.

## Why hand hygiene matters
Hand hygiene is the single most important measure for preventing healthcare-associated infections.

## Alcohol-based hand rub vs. soap and water
- **Hand rub:** 20–30 seconds, until hands are dry.
- **Soap and water:** 40–60 seconds. Use this when hands are visibly soiled.

## The 5 Moments for Hand Hygiene
1. Before touching a patient
2. Before a clean or aseptic procedure
3. After body-fluid exposure risk
4. After touching a patient
5. After touching patient surroundings

## Removing PPE (one recommended sequence)
Gloves → goggles/face shield → gown → mask/respirator, then perform hand hygiene.
$md$) returning id into v2;
  update public.notes set current_version_id = v2, status = 'published' where id = n2;

  -- ---------- Section B practice questions ----------
  perform pg_temp.q('practice', t_vitals, c_fund, 'What is the normal resting respiratory rate for a healthy adult?', 'easy', 'B',
    '8–10 breaths per minute', 'Below 12/min is bradypnoea in adults and may indicate opioid toxicity or CNS depression.',
    '12–20 breaths per minute', 'Correct. 12–20 breaths/min is the accepted normal adult resting range.',
    '24–30 breaths per minute', 'Above 20/min is tachypnoea in adults and is an early sign of deterioration.',
    '30–40 breaths per minute', 'This is closer to a normal rate for an infant, not an adult.', 'Demo item');
  perform pg_temp.q('practice', t_vitals, c_fund, 'A resting adult pulse rate above 100 beats per minute is described as:', 'easy', 'B',
    'Bradycardia', 'Bradycardia is a rate below 60 beats/min.',
    'Tachycardia', 'Correct. Tachycardia is a resting adult heart rate above 100 beats/min.',
    'Pulse deficit', 'Pulse deficit is the difference between the apical and radial rates, not a fast rate.',
    'Sinus arrhythmia', 'Sinus arrhythmia is rate variation with breathing and does not define a fast rate.', 'Demo item');
  perform pg_temp.q('practice', t_vitals, c_fund, 'Using a blood pressure cuff that is too small for the patient''s arm will most likely produce:', 'medium', 'A',
    'A falsely high reading', 'Correct. A narrow cuff needs more pressure to compress the artery, so it overestimates BP.',
    'A falsely low reading', 'A cuff that is too large tends to underestimate blood pressure.',
    'An accurate reading', 'Cuff size directly affects accuracy, so the reading will not be reliable.',
    'An error in the diastolic reading only', 'Both systolic and diastolic readings are affected.', 'Demo item');
  perform pg_temp.q('practice', t_vitals, c_fund, 'A pulse deficit is best defined as:', 'medium', 'C',
    'A pulse below 60 beats per minute', 'This describes bradycardia.',
    'A weak, thready pulse', 'This describes pulse volume/quality, not a deficit.',
    'The difference between the apical and radial pulse rates', 'Correct. It is measured by two nurses counting apical and radial pulses at the same time.',
    'The difference between systolic and diastolic pressure', 'This is the pulse pressure.', 'Demo item');
  perform pg_temp.q('practice', t_ipc, c_fund, 'What is the single most effective measure for preventing healthcare-associated infections?', 'easy', 'C',
    'Routine prophylactic antibiotics', 'Unnecessary antibiotics drive antimicrobial resistance and are not a general prevention measure.',
    'Isolating every patient', 'Isolation is used for specific infections, not routinely for all patients.',
    'Hand hygiene', 'Correct. Hand hygiene at the right moments is the cornerstone of infection prevention.',
    'Wearing a face mask at all times', 'Masks protect against specific routes but do not replace hand hygiene.', 'WHO Hand Hygiene Guidelines (2009)');
  perform pg_temp.q('practice', t_ipc, c_fund, 'According to WHO guidance, how long should an alcohol-based hand rub take?', 'medium', 'B',
    '5–10 seconds', 'This is too short to cover all hand surfaces.',
    '20–30 seconds', 'Correct. Rub until the hands are dry, for 20–30 seconds.',
    '40–60 seconds', 'This is the recommended duration for washing with soap and water.',
    '2 minutes', 'Longer than required for routine hand rub.', 'WHO Hand Hygiene Guidelines (2009)');
  perform pg_temp.q('practice', t_ipc, c_fund, 'Which sequence is a recommended order for removing PPE?', 'hard', 'A',
    'Gloves, goggles/face shield, gown, mask', 'Correct. The most contaminated items (gloves) come off first, and the mask comes off last.',
    'Mask, gown, goggles, gloves', 'Removing the mask first risks touching your face with contaminated gloves.',
    'Gown, mask, gloves, goggles', 'Gloves should come off first because they are the most contaminated.',
    'Goggles, mask, gown, gloves', 'Touching the face area early with contaminated gloves risks self-contamination.', 'CDC PPE sequence guidance');
  perform pg_temp.q('practice', t_ipc, c_fund, 'After giving an injection, the nurse should dispose of the used needle by:', 'easy', 'D',
    'Recapping it with both hands', 'Two-handed recapping is a leading cause of needlestick injury.',
    'Bending it before disposal', 'Bending or breaking needles increases injury risk.',
    'Placing it in the general waste bin', 'Sharps must never go in general waste.',
    'Placing it uncapped into a puncture-resistant sharps container', 'Correct. Dispose of it immediately at the point of use, without recapping.', 'Demo item');
  perform pg_temp.q('practice', t_ipc, c_fund, 'Which condition requires airborne precautions?', 'medium', 'A',
    'Pulmonary tuberculosis', 'Correct. TB spreads by airborne droplet nuclei; use a respirator and a negative-pressure room where available.',
    'MRSA wound infection', 'MRSA in a wound needs contact precautions.',
    'Clostridioides difficile diarrhoea', 'C. difficile needs contact precautions and soap-and-water hand washing.',
    'Seasonal influenza', 'Influenza mainly needs droplet precautions.', 'Demo item');
  perform pg_temp.q('practice', t_labour, c_mid, 'The first stage of labour ends with:', 'easy', 'C',
    'Rupture of the membranes', 'Membranes can rupture at any time and do not mark the end of a stage.',
    'Birth of the baby', 'The birth of the baby ends the second stage.',
    'Full dilatation of the cervix', 'Correct. The first stage ends at full (10 cm) cervical dilatation.',
    'Delivery of the placenta', 'Delivery of the placenta and membranes ends the third stage.', 'Demo item');

  -- ---------- Section C pool ----------
  insert into public.question_pools(bank, name, description) values ('section_c', 'Demo Mock Pool', 'Demonstration questions for Section C')
    returning id into pool_c;
  qid := pg_temp.q('section_c', t_vitals, c_fund, 'What is the lowest possible total score on the Glasgow Coma Scale?', 'easy', 'C',
    '0', 'Each GCS component scores at least 1, so the total cannot be 0.', '1', 'There are three components, each scoring at least 1.',
    '3', 'Correct. Eyes 1 + verbal 1 + motor 1 = 3.', '5', 'This is not the minimum.', 'Demo item');
  insert into public.question_pool_items values (pool_c, qid);
  qid := pg_temp.q('section_c', t_vitals, c_fund, 'Which position best helps a conscious adult with acute breathlessness?', 'easy', 'B',
    'Supine', 'Lying flat limits diaphragm movement and worsens breathlessness.',
    'High Fowler''s (upright)', 'Correct. Sitting upright lets the diaphragm descend and improves lung expansion.',
    'Trendelenburg', 'A head-down tilt pushes abdominal contents against the diaphragm.',
    'Prone', 'Prone positioning is used in specific ventilated cases, not for a conscious breathless patient.', 'Demo item');
  insert into public.question_pool_items values (pool_c, qid);
  qid := pg_temp.q('section_c', t_ipc, c_fund, 'Before giving any medication, the nurse confirms the patient''s identity by:', 'easy', 'D',
    'Checking the bed number', 'Patients move beds, so the bed number is not a reliable identifier.',
    'Asking "Are you Mr X?"', 'A leading question may get a mistaken "yes" from a confused patient.',
    'Checking the room number', 'Location is not an identifier.',
    'Using at least two patient identifiers, such as full name and date of birth', 'Correct. Two identifiers reduce wrong-patient errors.', 'Demo item');
  insert into public.question_pool_items values (pool_c, qid);
  qid := pg_temp.q('section_c', t_ipc, c_fund, 'Which position is safest for giving oral care to an unconscious patient?', 'medium', 'A',
    'Side-lying (lateral) position', 'Correct. Fluid drains out of the mouth, which reduces aspiration risk.',
    'Supine with the head flat', 'Fluid can pool in the pharynx and be aspirated.',
    'High Fowler''s', 'An unconscious patient cannot hold this position safely, and aspiration risk remains.',
    'Prone', 'Prone positioning is impractical for oral care and compromises airway assessment.', 'Demo item');
  insert into public.question_pool_items values (pool_c, qid);

  -- ---------- Section D pool (separate bank) ----------
  insert into public.question_pools(bank, name, description) values ('section_d', 'Demo Final Pool', 'Demonstration questions for Section D')
    returning id into pool_d;
  qid := pg_temp.q('section_d', t_labour, c_mid, 'What is the normal baseline fetal heart rate at term?', 'easy', 'B',
    '80–100 beats per minute', 'A baseline below 110 is bradycardia.', '110–160 beats per minute', 'Correct. A normal baseline is 110–160 bpm.',
    '160–200 beats per minute', 'A baseline above 160 is tachycardia.', '60–80 beats per minute', 'This is severe bradycardia.', 'Demo item');
  insert into public.question_pool_items values (pool_d, qid);
  qid := pg_temp.q('section_d', t_labour, c_mid, 'The third stage of labour is the period from:', 'easy', 'D',
    'Onset of contractions to full dilatation', 'This is the first stage.', 'Full dilatation to the birth of the baby', 'This is the second stage.',
    'Birth of the placenta to one hour postpartum', 'This is sometimes called the fourth stage.',
    'Birth of the baby to delivery of the placenta and membranes', 'Correct.', 'Demo item');
  insert into public.question_pool_items values (pool_d, qid);
  qid := pg_temp.q('section_d', t_labour, c_mid, 'Vitamin K is given to newborns mainly to prevent:', 'medium', 'A',
    'Vitamin K deficiency bleeding (haemorrhagic disease of the newborn)', 'Correct. Newborns have low vitamin K stores.',
    'Neonatal jaundice', 'Vitamin K does not prevent jaundice.', 'Neonatal hypoglycaemia', 'This is prevented by early feeding.',
    'Ophthalmia neonatorum', 'This is prevented with eye prophylaxis.', 'Demo item');
  insert into public.question_pool_items values (pool_d, qid);
  qid := pg_temp.q('section_d', t_labour, c_mid, 'When is the Apgar score routinely assessed?', 'easy', 'C',
    'Only at birth', 'A single score misses the response to resuscitation.', 'At 10 and 20 minutes only', 'These are additional times, not the routine ones.',
    'At 1 and 5 minutes after birth', 'Correct. It is repeated at 10 minutes if the 5-minute score is low.', 'At 24 hours', 'The Apgar score is an immediate assessment.', 'Demo item');
  insert into public.question_pool_items values (pool_d, qid);

  -- ---------- Stations ----------
  insert into public.clinical_stations(bank, kind, title, scenario, candidate_instructions, examiner_notes, duration_minutes, status, is_demo, topic_id)
  values ('practice', 'caosce', 'Hand Hygiene Station (Demo)',
    'You are about to examine a patient on a medical ward. Demonstrate hand hygiene using alcohol-based hand rub.',
    'Describe each step you would perform, in order.',
    'Look for correct technique covering all hand surfaces and the right duration.', 8, 'published', true, t_ipc)
  returning id into st_p;
  insert into public.station_checklist_items(station_id, position, step, points, is_critical) values
    (st_p, 1, 'Removes jewellery and checks nails are short', 1, false),
    (st_p, 2, 'Applies enough hand rub to cover all surfaces', 1, true),
    (st_p, 3, 'Rubs palm to palm, backs of hands, between fingers, thumbs and fingertips', 2, true),
    (st_p, 4, 'Continues for 20–30 seconds until dry', 1, true),
    (st_p, 5, 'Does not touch surroundings before patient contact', 1, false);

  insert into public.clinical_stations(bank, kind, title, scenario, candidate_instructions, examiner_notes, duration_minutes, status, is_demo, topic_id)
  values ('section_c', 'viva', 'Vital Signs Viva (Demo)',
    'A 54-year-old man after abdominal surgery has: RR 26/min, pulse 118/min, BP 92/58 mmHg, temperature 38.4 °C.',
    'Answer the examiner''s questions.', 'Candidate should recognise deterioration (possible sepsis) and escalate.', 10, 'published', true, t_vitals)
  returning id into st_c;
  insert into public.station_viva_questions(station_id, position, prompt, expected_points, marks) values
    (st_c, 1, 'Interpret these observations.', 'Tachypnoea, tachycardia, borderline hypotension, pyrexia; signs of deterioration and possible sepsis.', 3),
    (st_c, 2, 'What are your immediate nursing actions?', 'Escalate urgently using local early-warning protocol; repeat observations; oxygen as prescribed; monitor fluid balance; prepare for medical review.', 3);

  -- ---------- Exam configurations ----------
  insert into public.exam_configs(section, title, description, instructions, status, is_demo, position)
  values ('C', 'Demo Mock Examination', 'Shows the Papers 1–4 structure with a few demo questions.',
          'Answer every question. Your answers save automatically. The timer keeps running if you leave the page.',
          'published', true, 1)
  returning id into cfg_c;
  insert into public.exam_papers(config_id, paper_number, title, kind, question_count, duration_minutes, pool_id, pass_mark_percent)
  values (cfg_c, 1, 'Paper 1 (Demo)', 'objective', 4, 10, pool_c, 50),
         (cfg_c, 2, 'Paper 2 (Demo)', 'objective', 4, 10, pool_c, 50),
         (cfg_c, 3, 'Paper 3 (Demo)', 'objective', 4, 10, pool_c, 50);
  insert into public.exam_papers(config_id, paper_number, title, kind, question_count, duration_minutes)
  values (cfg_c, 4, 'Paper 4 — Viva & CAOSCE practice (Demo)', 'viva', 0, 20) returning id into paper;
  insert into public.exam_paper_stations(paper_id, station_id, position) values (paper, st_c, 1);

  insert into public.exam_configs(section, title, description, instructions, status, is_demo, programme_id, position)
  values ('D', 'Demo Final Examination', 'Separate Section D pool and configuration.', 'Treat this as a real sitting.',
          'published', true, rm, 1)
  returning id into cfg_d;
  insert into public.exam_papers(config_id, paper_number, title, kind, question_count, duration_minutes, pool_id, pass_mark_percent)
  values (cfg_d, 1, 'Paper 1 (Demo)', 'objective', 4, 10, pool_d, 50);
end $$;

commit;
