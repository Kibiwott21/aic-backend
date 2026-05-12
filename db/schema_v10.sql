-- ============================================================
-- AIC KAPSOWAR HMS v10 — COMPLETE SCHEMA
-- Single CEO/Hospital Director registers everything
-- Run: psql -U postgres -d aic_hms -f schema_v10.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── DEPARTMENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(6) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  dept_head_id UUID,  -- FK added after staff table
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO departments (code,name) VALUES
  ('ADM','Administration'),('CEO','Executive Office'),('HR','Human Resources'),
  ('REC','Reception'),('TRG','Triage'),('OUT','Outpatient'),
  ('INP','Inpatient/Ward'),('EMG','Emergency'),('SRG','Surgery/Theatre'),
  ('MAT','Maternity'),('PED','Paediatrics'),('ICU','ICU'),
  ('LAB','Laboratory'),('RAD','Radiology'),('PHA','Pharmacy'),
  ('PHY','Physiotherapy'),('NUT','Nutrition'),('MNT','Mental Health'),
  ('DEN','Dental'),('OPT','Ophthalmology'),('FIN','Finance'),
  ('SEC','Security'),('ICT','ICT'),('MAINT','Maintenance'),
  ('HK','Housekeeping'),('CAT','Catering'),('FARM','Farm'),
  ('PROC','Procurement')
ON CONFLICT DO NOTHING;

-- ── STAFF ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id VARCHAR(10) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE CHECK (
    date_of_birth IS NULL OR (
      date_of_birth <= CURRENT_DATE - INTERVAL '18 years' AND
      date_of_birth >= CURRENT_DATE - INTERVAL '70 years'
    )
  ),
  gender VARCHAR(20),
  nationality VARCHAR(50) DEFAULT 'Kenyan',
  national_id VARCHAR(30) UNIQUE,
  email VARCHAR(200) UNIQUE NOT NULL,
  phone VARCHAR(20),
  alt_phone VARCHAR(20),
  county VARCHAR(100),
  town VARCHAR(100),
  address TEXT,
  kin_name VARCHAR(150),
  kin_relation VARCHAR(50),
  kin_phone VARCHAR(20),
  dept_code VARCHAR(6) REFERENCES departments(code),
  job_title VARCHAR(100),
  -- Role hierarchy: ceo > medical_director > nursing_director > finance_manager > hr_officer > dept_head > clinical/support staff
  role VARCHAR(50) NOT NULL CHECK (role IN (
    'ceo','medical_director','nursing_director','finance_manager','hr_officer',
    'dept_head','doctor','nurse','clinical_officer','receptionist','pharmacist',
    'lab_tech','radiographer','physiotherapist','dentist','optometrist',
    'midwife','counsellor','accountant','billing_clerk','security_officer',
    'ict_officer','maintenance','housekeeping','catering','farm_worker',
    'procurement','records_officer','staff'
  )),
  is_dept_head BOOLEAN DEFAULT FALSE,
  dept_head_of VARCHAR(6) REFERENCES departments(code),
  qualification VARCHAR(300),
  licence_no VARCHAR(100),
  licence_expiry DATE,
  start_date DATE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(200),
  email_token_expires TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP,
  last_login_ip VARCHAR(45),
  must_change_password BOOLEAN DEFAULT TRUE,
  remote_access_allowed BOOLEAN DEFAULT FALSE,
  remote_access_expiry TIMESTAMP,
  registered_by UUID,  -- FK to self, set after insert
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Single CEO constraint
CREATE OR REPLACE FUNCTION check_ceo_limit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'ceo' THEN
    IF (SELECT COUNT(*) FROM staff WHERE role='ceo' AND id != COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::UUID)) >= 1 THEN
      RAISE EXCEPTION 'Only one CEO/Hospital Director is allowed in the system';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS enforce_ceo_limit ON staff;
CREATE TRIGGER enforce_ceo_limit BEFORE INSERT OR UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION check_ceo_limit();

-- FK: dept_head
ALTER TABLE departments ADD CONSTRAINT fk_dept_head FOREIGN KEY (dept_head_id) REFERENCES staff(id) ON DELETE SET NULL;

-- Default CEO (password: CEO@AIC2026#)
INSERT INTO staff (staff_id,first_name,last_name,email,phone,dept_code,job_title,role,
  password_hash,email_verified,must_change_password,is_active)
VALUES ('CEO0001','Hospital','Director','ceo@aickapsowar.go.ke','+254700000001','CEO',
  'Chief Executive Officer / Hospital Director','ceo',
  '$2b$10$YGmxQqnECGWWi4fGIVKNaeAYf7mT9bqvBq5OxmN3Y5KXAiRh6I0Oq',
  TRUE,FALSE,TRUE)
ON CONFLICT DO NOTHING;

-- ── PATIENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id VARCHAR(12) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(20),
  nationality VARCHAR(50) DEFAULT 'Kenyan',
  national_id VARCHAR(30),
  email VARCHAR(200),
  phone VARCHAR(20) NOT NULL,
  alt_phone VARCHAR(20),
  county VARCHAR(100),
  town VARCHAR(100),
  address TEXT,
  kin_name VARCHAR(150),
  kin_relation VARCHAR(50),
  kin_phone VARCHAR(20),
  blood_group VARCHAR(5),
  allergies TEXT,
  chronic_conditions TEXT,
  current_medications TEXT,
  insurance_provider VARCHAR(100),
  insurance_no VARCHAR(50),
  insurance_expiry DATE,
  nhif_no VARCHAR(50),
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(200),
  email_token_expires TIMESTAMP,
  portal_password_hash VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  registered_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patients_search ON patients(lower(first_name||' '||last_name));
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

-- ── PATIENT JOURNEY ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_journey (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_no VARCHAR(25) UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  visit_type VARCHAR(30) DEFAULT 'OPD' CHECK (visit_type IN ('OPD','Emergency','Follow-up','Inpatient','Maternity')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','completed','discharged','referred')),
  current_dept VARCHAR(6) REFERENCES departments(code),
  urgency VARCHAR(20) DEFAULT 'Routine' CHECK (urgency IN ('Emergency','Urgent','Routine')),
  chief_complaint TEXT,
  invoice_id UUID,
  started_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- ── JOURNEY STEPS (immutable once submitted) ──────────────────
CREATE TABLE IF NOT EXISTS journey_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id UUID NOT NULL REFERENCES patient_journey(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  step_no INTEGER NOT NULL,
  dept_code VARCHAR(6) REFERENCES departments(code),
  dept_name VARCHAR(100),
  recorded_by UUID REFERENCES staff(id),
  recorder_name VARCHAR(200),
  recorder_role VARCHAR(50),
  action VARCHAR(50),
  vitals JSONB,
  findings TEXT,
  treatment TEXT,
  diagnosis TEXT,
  next_dept VARCHAR(6) REFERENCES departments(code),
  notes TEXT,
  prescription_id UUID,
  lab_request_id UUID,
  submitted BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP,
  locked BOOLEAN DEFAULT FALSE,
  locked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_journey ON journey_steps(journey_id);

CREATE OR REPLACE FUNCTION lock_step_on_submit() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked = TRUE THEN
    RAISE EXCEPTION 'This step is locked and cannot be edited after submission';
  END IF;
  IF NEW.submitted = TRUE AND OLD.submitted = FALSE THEN
    NEW.submitted_at := NOW(); NEW.locked := TRUE; NEW.locked_at := NOW();
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS step_lock_trigger ON journey_steps;
CREATE TRIGGER step_lock_trigger BEFORE UPDATE ON journey_steps FOR EACH ROW EXECUTE FUNCTION lock_step_on_submit();

-- ── BEDS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bed_no VARCHAR(20) UNIQUE NOT NULL,
  ward VARCHAR(6) REFERENCES departments(code),
  ward_name VARCHAR(100),
  bed_type VARCHAR(30) DEFAULT 'General' CHECK (bed_type IN ('General','Private','ICU','HDU','Maternity','Paediatric','Emergency')),
  status VARCHAR(20) DEFAULT 'Available' CHECK (status IN ('Available','Occupied','Maintenance','Reserved')),
  current_patient_id UUID REFERENCES patients(id),
  admitted_at TIMESTAMP,
  journey_id UUID REFERENCES patient_journey(id),
  daily_rate NUMERIC(10,2) DEFAULT 1500,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed beds
INSERT INTO beds (bed_no,ward,ward_name,bed_type,daily_rate) VALUES
  ('GWA-01','INP','General Ward','General',1500),('GWA-02','INP','General Ward','General',1500),
  ('GWA-03','INP','General Ward','General',1500),('GWA-04','INP','General Ward','General',1500),
  ('GWA-05','INP','General Ward','General',1500),('GWA-06','INP','General Ward','General',1500),
  ('PRI-01','INP','Private Room','Private',4000),('PRI-02','INP','Private Room','Private',4000),
  ('ICU-01','ICU','ICU','ICU',8000),('ICU-02','ICU','ICU','ICU',8000),('ICU-03','ICU','ICU','ICU',8000),
  ('MAT-01','MAT','Maternity','Maternity',2000),('MAT-02','MAT','Maternity','Maternity',2000),
  ('MAT-03','MAT','Maternity','Maternity',2000),('MAT-04','MAT','Maternity','Maternity',2000),
  ('PED-01','PED','Paediatric Ward','Paediatric',1800),('PED-02','PED','Paediatric Ward','Paediatric',1800),
  ('PED-03','PED','Paediatric Ward','Paediatric',1800),
  ('EMG-01','EMG','Emergency Bay','Emergency',2500),('EMG-02','EMG','Emergency Bay','Emergency',2500),
  ('EMG-03','EMG','Emergency Bay','Emergency',2500),
  ('SRG-01','SRG','Surgical Recovery','General',2000),('SRG-02','SRG','Surgical Recovery','General',2000)
ON CONFLICT DO NOTHING;

-- ── APPOINTMENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_no VARCHAR(20) UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID REFERENCES staff(id),
  dept_code VARCHAR(6) REFERENCES departments(code),
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Confirmed','Attended','Cancelled','No-Show','Rescheduled')),
  request_type VARCHAR(20) DEFAULT 'request' CHECK (request_type IN ('request','confirmed')),
  -- Patient requests, dept head assigns
  requested_by_patient BOOLEAN DEFAULT FALSE,
  preferred_doctor_id UUID REFERENCES staff(id),
  assigned_by UUID REFERENCES staff(id),
  assigned_at TIMESTAMP,
  cancellation_reason TEXT,
  notes TEXT,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT appt_not_past CHECK (appointment_date >= CURRENT_DATE - INTERVAL '1 day'),
  CONSTRAINT appt_valid_time CHECK (appointment_time BETWEEN '08:00' AND '17:00')
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON appointments(doctor_id);

-- ── PRESCRIPTIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  prescribed_by UUID REFERENCES staff(id),
  prescriber_name VARCHAR(200),
  items JSONB NOT NULL DEFAULT '[]',
  clinical_notes TEXT,
  allergy_checked BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Dispensed','Partially Dispensed','Cancelled')),
  dispensed_by UUID REFERENCES staff(id),
  dispensed_at TIMESTAMP,
  dispensing_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── DRUGS/PHARMACY CATALOGUE ──────────────────────────────────
CREATE TABLE IF NOT EXISTS drugs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  generic_name VARCHAR(200) NOT NULL,
  brand_name VARCHAR(200),
  formulation VARCHAR(100),
  strength VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'tablet',
  buying_price NUMERIC(10,2) DEFAULT 0,
  selling_price NUMERIC(10,2) DEFAULT 0,
  nhif_covered BOOLEAN DEFAULT FALSE,
  nhif_rate NUMERIC(10,2) DEFAULT 0,
  stock_qty INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 50,
  expiry_date DATE,
  batch_no VARCHAR(100),
  supplier VARCHAR(200),
  controlled BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed common drugs
INSERT INTO drugs (generic_name,formulation,strength,unit,buying_price,selling_price,nhif_covered,nhif_rate,stock_qty,reorder_level) VALUES
  ('Amoxicillin','Capsule','500mg','capsule',8,25,TRUE,15,500,100),
  ('Paracetamol','Tablet','500mg','tablet',2,8,TRUE,5,1000,200),
  ('Metronidazole','Tablet','400mg','tablet',5,20,TRUE,12,300,100),
  ('Cotrimoxazole','Tablet','480mg','tablet',3,12,TRUE,8,400,100),
  ('Ciprofloxacin','Tablet','500mg','tablet',15,45,TRUE,30,200,50),
  ('Ibuprofen','Tablet','400mg','tablet',4,15,FALSE,0,300,100),
  ('ORS Sachet','Powder','-','sachet',10,30,TRUE,20,200,50),
  ('Omeprazole','Capsule','20mg','capsule',12,40,FALSE,0,150,50),
  ('Salbutamol Inhaler','Inhaler','100mcg','inhaler',200,500,TRUE,300,50,20),
  ('Metformin','Tablet','500mg','tablet',8,25,TRUE,15,200,50),
  ('Amlodipine','Tablet','5mg','tablet',10,35,TRUE,20,150,50),
  ('Enalapril','Tablet','10mg','tablet',12,40,TRUE,25,100,30),
  ('Artemether/Lumefantrine','Tablet','20/120mg','tablet',50,120,TRUE,80,300,100),
  ('Albendazole','Tablet','400mg','tablet',15,50,FALSE,0,200,50),
  ('IV Fluids NS 1L','Solution','0.9%','bag',80,200,TRUE,150,100,30)
ON CONFLICT DO NOTHING;

-- ── LAB TESTS CATALOGUE ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) DEFAULT 'General',
  unit VARCHAR(50),
  normal_range VARCHAR(100),
  price NUMERIC(10,2) DEFAULT 0,
  nhif_covered BOOLEAN DEFAULT FALSE,
  nhif_rate NUMERIC(10,2) DEFAULT 0,
  turnaround_hours INTEGER DEFAULT 2,
  is_external BOOLEAN DEFAULT FALSE,
  external_cost NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO lab_tests (name,category,unit,normal_range,price,nhif_covered,nhif_rate,turnaround_hours) VALUES
  ('Full Blood Count (FBC)','Haematology','Cells/μL','Variable',500,TRUE,400,2),
  ('Blood Sugar (Random)','Biochemistry','mmol/L','3.9-7.8',200,TRUE,150,1),
  ('Blood Sugar (Fasting)','Biochemistry','mmol/L','3.9-5.5',200,TRUE,150,1),
  ('Malaria RDT','Parasitology','Positive/Negative','Negative',300,TRUE,200,1),
  ('Malaria Film (Thick & Thin)','Parasitology','Positive/Negative','Negative',400,TRUE,300,2),
  ('HIV Test','Serology','Positive/Negative','Negative',0,TRUE,0,1),
  ('Urine Analysis','Urinalysis','Various','Normal',200,TRUE,150,1),
  ('Stool Analysis','Parasitology','Various','Normal',250,TRUE,200,2),
  ('Widal Test','Serology','Titre','<1:80',500,FALSE,0,4),
  ('VDRL/RPR (Syphilis)','Serology','Positive/Negative','Negative',400,TRUE,300,2),
  ('Pregnancy Test (UPT)','Serology','Positive/Negative','Negative',200,FALSE,0,1),
  ('Liver Function Tests','Biochemistry','U/L','Variable',1500,TRUE,1200,4),
  ('Kidney Function Tests','Biochemistry','mmol/L','Variable',1500,TRUE,1200,4),
  ('Lipid Profile','Biochemistry','mmol/L','Variable',1200,FALSE,0,4),
  ('Thyroid Function (TSH)','Biochemistry','mIU/L','0.4-4.0',2000,FALSE,0,6),
  ('Blood Group & Crossmatch','Blood Bank','Type','N/A',500,TRUE,400,2),
  ('ESR','Haematology','mm/hr','M:<15 F:<20',300,FALSE,0,2),
  ('HbA1C','Biochemistry','%','<5.7%',1500,TRUE,1200,4),
  ('CD4 Count','Immunology','Cells/μL','>500',2500,TRUE,2000,8),
  ('Sputum AFB (TB)','Microbiology','Positive/Negative','Negative',0,TRUE,0,48)
ON CONFLICT DO NOTHING;

-- ── LAB REQUESTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  requested_by UUID REFERENCES staff(id),
  requester_name VARCHAR(200),
  requester_role VARCHAR(50),
  tests JSONB NOT NULL DEFAULT '[]',
  urgency VARCHAR(20) DEFAULT 'Routine' CHECK (urgency IN ('Routine','Urgent','STAT')),
  clinical_notes TEXT,
  sample_collected_at TIMESTAMP,
  sample_collected_by UUID REFERENCES staff(id),
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Sample Collected','In Progress','Completed','Cancelled')),
  results JSONB,
  critical_values BOOLEAN DEFAULT FALSE,
  lab_notes TEXT,
  reported_by UUID REFERENCES staff(id),
  reporter_name VARCHAR(200),
  reported_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── PRICE CATALOGUE ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_catalogue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(50) NOT NULL CHECK (category IN ('consultation','ward','procedure','radiology','theatre','other')),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  private_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  nhif_price NUMERIC(10,2) DEFAULT 0,
  nhif_covered BOOLEAN DEFAULT FALSE,
  effective_date DATE DEFAULT CURRENT_DATE,
  previous_price NUMERIC(10,2),
  changed_by UUID REFERENCES staff(id),
  change_reason TEXT,
  requires_approval BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES staff(id),
  approved_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed price catalogue
INSERT INTO price_catalogue (category,name,private_price,nhif_price,nhif_covered) VALUES
  ('consultation','Registration Fee',200,150,TRUE),
  ('consultation','Triage Assessment',100,0,FALSE),
  ('consultation','Clinical Officer Consultation',300,250,TRUE),
  ('consultation','Medical Officer Consultation',500,400,TRUE),
  ('consultation','Specialist Consultation',1500,1200,TRUE),
  ('consultation','After-hours Consultation',750,600,TRUE),
  ('ward','General Ward (per night)',1500,1200,TRUE),
  ('ward','Private Room (per night)',4000,0,FALSE),
  ('ward','ICU (per night)',8000,6000,TRUE),
  ('ward','Maternity Ward (per night)',2000,1600,TRUE),
  ('ward','Paediatric Ward (per night)',1800,1440,TRUE),
  ('procedure','Normal Delivery',3500,2800,TRUE),
  ('procedure','Caesarean Section',25000,20000,TRUE),
  ('procedure','Minor Surgery',5000,4000,TRUE),
  ('procedure','Major Surgery',15000,12000,TRUE),
  ('procedure','Emergency Surgery',20000,16000,TRUE),
  ('procedure','General Anaesthesia',8000,6400,TRUE),
  ('procedure','Spinal Anaesthesia',5000,4000,TRUE),
  ('procedure','Dental Extraction (Simple)',800,0,FALSE),
  ('procedure','Dental Extraction (Surgical)',2500,0,FALSE),
  ('procedure','Physiotherapy Session',500,400,TRUE),
  ('radiology','Chest X-ray (PA view)',1200,960,TRUE),
  ('radiology','Abdominal X-ray',1500,1200,TRUE),
  ('radiology','Abdominal Ultrasound',2500,2000,TRUE),
  ('radiology','Obstetric Ultrasound',2000,1600,TRUE),
  ('radiology','ECG',800,640,TRUE)
ON CONFLICT DO NOTHING;

-- Price change approval requests
CREATE TABLE IF NOT EXISTS price_change_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogue_id UUID REFERENCES price_catalogue(id),
  item_name VARCHAR(200),
  current_price NUMERIC(10,2),
  proposed_price NUMERIC(10,2),
  reason TEXT NOT NULL,
  requested_by UUID REFERENCES staff(id),
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Declined')),
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMP,
  ceo_comment TEXT,
  effective_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── INVOICES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_no VARCHAR(30) UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  nhif_amount NUMERIC(12,2) DEFAULT 0,
  insurance_amount NUMERIC(12,2) DEFAULT 0,
  discount_amount NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  balance NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  status VARCHAR(20) DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Partial','Paid','Waived','Insurance')),
  payment_required_before_service BOOLEAN DEFAULT FALSE,
  payment_cleared BOOLEAN DEFAULT FALSE,
  insurance_provider VARCHAR(100),
  insurance_no VARCHAR(50),
  insurance_claim_status VARCHAR(20) DEFAULT 'None',
  waiver_reason TEXT,
  waiver_approved_by UUID REFERENCES staff(id),
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── PAYMENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(30) DEFAULT 'Cash' CHECK (payment_method IN ('Cash','M-Pesa','NHIF','Insurance','Card','Bank Transfer','Waiver')),
  mpesa_code VARCHAR(50),
  reference VARCHAR(100),
  received_by UUID REFERENCES staff(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── WARD ADMISSIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admission_no VARCHAR(20) UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  bed_id UUID REFERENCES beds(id),
  ward_code VARCHAR(6) REFERENCES departments(code),
  admitted_at TIMESTAMP DEFAULT NOW(),
  admission_date DATE DEFAULT CURRENT_DATE,
  admitting_doctor UUID REFERENCES staff(id),
  admitting_diagnosis TEXT,
  daily_charges_running NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'Admitted' CHECK (status IN ('Admitted','Discharged','Transferred','Deceased')),
  discharge_date DATE,
  discharge_time TIMESTAMP,
  discharge_notes TEXT,
  discharge_summary TEXT,
  length_of_stay INTEGER GENERATED ALWAYS AS (COALESCE(EXTRACT(DAY FROM COALESCE(discharge_time,NOW())-admitted_at)::INTEGER,0)) STORED,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── VITALS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  admission_id UUID REFERENCES admissions(id),
  recorded_by UUID REFERENCES staff(id),
  recorder_name VARCHAR(200),
  temperature NUMERIC(4,1),
  blood_pressure_sys INTEGER,
  blood_pressure_dia INTEGER,
  pulse_rate INTEGER,
  respiratory_rate INTEGER,
  oxygen_saturation NUMERIC(4,1),
  weight NUMERIC(6,2),
  height NUMERIC(5,1),
  blood_sugar NUMERIC(6,2),
  gcs INTEGER,
  urgency_classification VARCHAR(20) CHECK (urgency_classification IN ('Emergency','Urgent','Routine')),
  notes TEXT,
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- ── THEATRE OPERATIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS theatre_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  op_no VARCHAR(20) UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  procedure_name VARCHAR(300) NOT NULL,
  procedure_type VARCHAR(30) DEFAULT 'Elective' CHECK (procedure_type IN ('Elective','Emergency','Urgent')),
  theatre_bay VARCHAR(20) DEFAULT 'Theatre 1',
  surgeon_id UUID REFERENCES staff(id),
  anaesthetist_id UUID REFERENCES staff(id),
  scrub_nurse_id UUID REFERENCES staff(id),
  scheduled_date DATE,
  scheduled_time TIME,
  actual_start TIMESTAMP,
  actual_end TIMESTAMP,
  anaesthesia_type VARCHAR(30) CHECK (anaesthesia_type IN ('General','Spinal','Local','Regional','None')),
  pre_op_complete BOOLEAN DEFAULT FALSE,
  consent_signed BOOLEAN DEFAULT FALSE,
  fasting_confirmed BOOLEAN DEFAULT FALSE,
  payment_cleared BOOLEAN DEFAULT FALSE,
  status VARCHAR(30) DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Pre-Op','In Progress','Completed','Cancelled','Postponed')),
  post_op_notes TEXT,
  complications TEXT,
  consumables JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── DELIVERIES (Maternity) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  admission_id UUID REFERENCES admissions(id),
  midwife_id UUID REFERENCES staff(id),
  delivery_date DATE NOT NULL,
  delivery_time TIME NOT NULL,
  delivery_type VARCHAR(30) CHECK (delivery_type IN ('Normal','Caesarean','Forceps','Vacuum','Breech')),
  baby_weight NUMERIC(5,3),
  baby_gender VARCHAR(20),
  apgar_1min INTEGER,
  apgar_5min INTEGER,
  outcome VARCHAR(30) CHECK (outcome IN ('Live Birth','Stillbirth','Neonatal Death')),
  complications TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── ATTENDANCE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  clock_in TIMESTAMP,
  clock_out TIMESTAMP,
  status VARCHAR(20) DEFAULT 'Present' CHECK (status IN ('Present','Late','Absent','Leave','Holiday')),
  late_reason TEXT,
  hours_worked NUMERIC(4,2) GENERATED ALWAYS AS (
    CASE WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL
    THEN EXTRACT(EPOCH FROM (clock_out - clock_in))/3600 ELSE 0 END
  ) STORED,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(staff_id,attendance_date)
);

-- ── LEAVE REQUESTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  leave_type VARCHAR(30) DEFAULT 'annual' CHECK (leave_type IN ('annual','sick','maternity','paternity','compassionate','study','unpaid')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_requested INTEGER GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Declined','Cancelled')),
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMP,
  admin_comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT leave_end_after_start CHECK (end_date >= start_date),
  CONSTRAINT leave_not_past CHECK (start_date >= CURRENT_DATE - INTERVAL '1 day')
);

-- Leave balances
CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id) UNIQUE,
  annual INTEGER DEFAULT 21,
  sick INTEGER DEFAULT 14,
  maternity INTEGER DEFAULT 90,
  paternity INTEGER DEFAULT 14,
  compassionate INTEGER DEFAULT 5,
  study INTEGER DEFAULT 5,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── DAILY REPORTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_no VARCHAR(30) UNIQUE NOT NULL,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  staff_id UUID NOT NULL REFERENCES staff(id),
  staff_name VARCHAR(200) NOT NULL,
  dept_code VARCHAR(6) REFERENCES departments(code),
  dept_name VARCHAR(100),
  role VARCHAR(50),
  report_type VARCHAR(50) DEFAULT 'Daily',
  title VARCHAR(300) NOT NULL,
  summary TEXT NOT NULL,
  metrics JSONB DEFAULT '{}',
  challenges TEXT,
  action_needed TEXT,
  status VARCHAR(20) DEFAULT 'Submitted' CHECK (status IN ('Draft','Submitted','Reviewed','Actioned')),
  admin_feedback TEXT,
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMP,
  submitted BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP,
  locked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(staff_id,report_date)
);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL,
  recipient_type VARCHAR(20) DEFAULT 'staff' CHECK (recipient_type IN ('staff','patient','all')),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'general' CHECK (type IN ('general','appointment','lab','prescription','billing','leave','report','alert','emergency','result')),
  action_url VARCHAR(300),
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_at TIMESTAMP,
  priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id,is_read);

-- ── ANNOUNCEMENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message TEXT NOT NULL,
  created_by UUID REFERENCES staff(id),
  target VARCHAR(20) DEFAULT 'all',
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── WIFI ACCESS CONTROL ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS wifi_access_control (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restriction_enabled BOOLEAN DEFAULT TRUE,
  changed_by UUID REFERENCES staff(id),
  changed_at TIMESTAMP DEFAULT NOW(),
  reason TEXT
);
INSERT INTO wifi_access_control (restriction_enabled) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS wifi_exemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  granted_by UUID REFERENCES staff(id),
  granted_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  reason TEXT,
  is_active BOOLEAN DEFAULT TRUE
);

-- ── AUDIT LOG ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  user_type VARCHAR(20),
  user_name VARCHAR(200),
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100),
  resource_id VARCHAR(200),
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);

-- ── SECURITY ALERTS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) DEFAULT 'Medium' CHECK (severity IN ('Low','Medium','High','Critical')),
  message TEXT NOT NULL,
  source_ip VARCHAR(45),
  source_user VARCHAR(200),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','resolved','dismissed')),
  resolved_by UUID REFERENCES staff(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── HR ADDITIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disciplinary_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  type VARCHAR(30) CHECK (type IN ('verbal_warning','written_warning','suspension','final_warning','dismissal')),
  details TEXT NOT NULL,
  incident_date DATE NOT NULL,
  recorded_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_certifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  cert_type VARCHAR(200) NOT NULL,
  issue_date DATE,
  expiry_date DATE,
  cert_no VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── AUTO-NOTIFICATION TRIGGERS ────────────────────────────────
CREATE OR REPLACE FUNCTION create_notification(
  p_recipient_id UUID, p_type VARCHAR, p_title VARCHAR,
  p_message TEXT, p_action_url VARCHAR DEFAULT NULL, p_priority VARCHAR DEFAULT 'normal'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO notifications(recipient_id,type,title,message,action_url,priority)
  VALUES(p_recipient_id,p_type,p_title,p_message,p_action_url,p_priority);
END; $$ LANGUAGE plpgsql;

-- Notify on leave review
CREATE OR REPLACE FUNCTION notify_leave_review() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status != OLD.status AND NEW.status IN ('Approved','Declined') THEN
    PERFORM create_notification(
      NEW.staff_id,'leave',
      CASE WHEN NEW.status='Approved' THEN '✅ Leave Approved' ELSE '❌ Leave Declined' END,
      'Your '||NEW.leave_type||' leave ('||NEW.start_date||' → '||NEW.end_date||') has been '||LOWER(NEW.status)||
      CASE WHEN NEW.admin_comment IS NOT NULL THEN '. Note: '||NEW.admin_comment ELSE '' END,
      'leave-requests.html'
    );
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS leave_notify ON leave_requests;
CREATE TRIGGER leave_notify AFTER UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION notify_leave_review();

-- Notify pharmacy on new prescription
CREATE OR REPLACE FUNCTION notify_new_prescription() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications(recipient_id,type,title,message,action_url,priority)
  SELECT id,'prescription','💊 New Prescription Waiting',
    'A new prescription requires dispensing in the pharmacy.',
    'pharmacy-dashboard.html','normal'
  FROM staff WHERE role='pharmacist' AND is_active=TRUE;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS presc_notify ON prescriptions;
CREATE TRIGGER presc_notify AFTER INSERT ON prescriptions FOR EACH ROW EXECUTE FUNCTION notify_new_prescription();

-- Notify doctor when lab results ready
CREATE OR REPLACE FUNCTION notify_lab_ready() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status='Completed' AND OLD.status!='Completed' THEN
    PERFORM create_notification(
      NEW.requested_by,'lab','🔬 Lab Results Ready',
      'Lab results are ready for your patient.',
      'lab-dashboard.html',
      CASE WHEN NEW.critical_values THEN 'urgent' ELSE 'normal' END
    );
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lab_ready_notify ON lab_requests;
CREATE TRIGGER lab_ready_notify AFTER UPDATE ON lab_requests FOR EACH ROW EXECUTE FUNCTION notify_lab_ready();

-- Notify patient when appointment confirmed
CREATE OR REPLACE FUNCTION notify_appt_confirmed() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status='Confirmed' AND OLD.status='Pending' AND NEW.patient_id IS NOT NULL THEN
    PERFORM create_notification(
      NEW.patient_id,'appointment','📅 Appointment Confirmed',
      'Your appointment on '||NEW.appointment_date||' at '||NEW.appointment_time||' has been confirmed.',
      'patient-dashboard.html','high'
    );
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS appt_confirm_notify ON appointments;
CREATE TRIGGER appt_confirm_notify AFTER UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION notify_appt_confirmed();

-- ── VIEWS ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_bed_availability AS
SELECT b.*,
  p.first_name||' '||p.last_name as patient_name,
  p.patient_id as pid
FROM beds b LEFT JOIN patients p ON p.id=b.current_patient_id
ORDER BY b.ward,b.bed_no;

CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT DATE(p.created_at) as revenue_date,
  SUM(p.amount) as total_collected,
  COUNT(*) as transaction_count,
  SUM(CASE WHEN p.payment_method='Cash' THEN p.amount ELSE 0 END) as cash,
  SUM(CASE WHEN p.payment_method='M-Pesa' THEN p.amount ELSE 0 END) as mpesa,
  SUM(CASE WHEN p.payment_method='NHIF' THEN p.amount ELSE 0 END) as nhif,
  SUM(CASE WHEN p.payment_method='Insurance' THEN p.amount ELSE 0 END) as insurance
FROM payments p GROUP BY DATE(p.created_at) ORDER BY revenue_date DESC;

CREATE OR REPLACE VIEW v_low_stock_drugs AS
SELECT * FROM drugs WHERE stock_qty<=reorder_level AND is_active=TRUE ORDER BY stock_qty ASC;

CREATE OR REPLACE VIEW v_dept_workload AS
SELECT 'Pharmacy' as department,
  (SELECT COUNT(*) FROM prescriptions WHERE status='Pending') as pending_count
UNION ALL SELECT 'Laboratory',
  (SELECT COUNT(*) FROM lab_requests WHERE status IN ('Pending','Sample Collected'))
UNION ALL SELECT 'Finance/Billing',
  (SELECT COUNT(*) FROM invoices WHERE status IN ('Unpaid','Partial'))
UNION ALL SELECT 'Triage',
  (SELECT COUNT(*) FROM patient_journey WHERE status='active' AND current_dept='TRG' AND visit_date=CURRENT_DATE)
UNION ALL SELECT 'Reception',
  (SELECT COUNT(*) FROM patient_journey WHERE status='active' AND current_dept='REC' AND visit_date=CURRENT_DATE);

-- ── REPORT ROUTING (v10.1 addition) ──────────────────────────────
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS reviewer_role VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reviewed_by_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS escalated_by UUID REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS actioned_by UUID REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS actioned_at TIMESTAMP;

-- Auto-set reviewer_role on insert based on dept_code
CREATE OR REPLACE FUNCTION set_report_reviewer() RETURNS TRIGGER AS $$
BEGIN
  NEW.reviewer_role := CASE NEW.dept_code
    WHEN 'FIN' THEN 'finance_manager'
    WHEN 'LAB','OUT','EMG','SRG','RAD','DEN','OPT','PED','MNT','PHY','NUT' THEN 'medical_director'
    WHEN 'MAT','INP','ICU','TRG','PHA' THEN 'nursing_director'
    WHEN 'HR','REC','SEC','ICT','MAINT','HK','CAT','FARM','PROC' THEN 'hr_officer'
    ELSE 'ceo'
  END;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS report_reviewer_trigger ON daily_reports;
CREATE TRIGGER report_reviewer_trigger BEFORE INSERT ON daily_reports FOR EACH ROW EXECUTE FUNCTION set_report_reviewer();

-- Staff visitor log for security
CREATE TABLE IF NOT EXISTS visitor_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  visitor_name VARCHAR(200) NOT NULL,
  id_no VARCHAR(50),
  phone VARCHAR(20),
  visiting_person VARCHAR(200),
  purpose TEXT,
  entry_time TIMESTAMP DEFAULT NOW(),
  exit_time TIMESTAMP,
  logged_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Staff profile editable fields
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS office_location VARCHAR(200),
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS signature_text TEXT;
