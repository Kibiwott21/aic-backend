SET client_encoding = UTF8;
-- ============================================================
-- AIC KAPSOWAR HMS v7 — COMPLETE WORKFLOW DATABASE
-- psql -U postgres -c "CREATE DATABASE aic_hms;"
-- psql -U postgres -d aic_hms -f schema.sql
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- DEPARTMENTS
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code CHAR(3) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);
INSERT INTO departments (code,name) VALUES
  ('ADM','Administration'),('REC','Reception'),('TRG','Triage'),
  ('OUT','Outpatient'),('INP','Inpatient'),('EMG','Emergency'),
  ('SRG','Surgery'),('MAT','Maternity'),('PED','Pediatrics'),
  ('ICU','ICU'),('LAB','Laboratory'),('RAD','Radiology'),
  ('PHA','Pharmacy'),('PHY','Physiotherapy'),('NUT','Nutrition'),
  ('MNT','Mental Health'),('DEN','Dental'),('OPT','Ophthalmology'),
  ('FIN','Finance'),('SEC','Security')
ON CONFLICT DO NOTHING;

-- STAFF
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id VARCHAR(8) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE CHECK (
    date_of_birth <= CURRENT_DATE + INTERVAL '1 day' 
    AND date_of_birth <= CURRENT_DATE - INTERVAL '18 years'
  ),
  gender VARCHAR(20),
  nationality VARCHAR(50) DEFAULT 'Kenyan',
  national_id VARCHAR(30),
  email VARCHAR(200) UNIQUE NOT NULL,
  phone VARCHAR(20),
  alt_phone VARCHAR(20),
  county VARCHAR(100),
  town VARCHAR(100),
  address TEXT,
  kin_name VARCHAR(150),
  kin_relation VARCHAR(50),
  kin_phone VARCHAR(20),
  dept_code CHAR(3) REFERENCES departments(code),
  job_title VARCHAR(100),
  role VARCHAR(50) NOT NULL CHECK (role IN (
    'admin','doctor','nurse','receptionist','pharmacist',
    'lab_tech','records_officer','accountant','staff','triage'
  )),
  admin_type VARCHAR(20) CHECK (admin_type IN ('director','security','hr',NULL)),
  qualification VARCHAR(200),
  licence_no VARCHAR(100),
  start_date DATE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(200),
  email_token_expires TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP,
  must_change_password BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Max 3 admins
CREATE OR REPLACE FUNCTION check_admin_limit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF (SELECT COUNT(*) FROM staff WHERE role='admin' AND id != COALESCE(NEW.id, uuid_generate_v4())) >= 3 THEN
      RAISE EXCEPTION 'Maximum 3 admins allowed';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS enforce_admin_limit ON staff;
CREATE TRIGGER enforce_admin_limit BEFORE INSERT OR UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION check_admin_limit();

-- Default 3 admins (password: Admin@AIC2026)
INSERT INTO staff (staff_id,first_name,last_name,email,password_hash,role,admin_type,dept_code,job_title,email_verified,must_change_password) VALUES
  ('ADM0001','Hospital','Director','aic.admin0001@gmail.com','$2b$10$YGmxQqnECGWWi4fGIVKNaeAYf7mT9bqvBq5OxmN3Y5KXAiRh6I0Oq','admin','director','ADM','Hospital Director',TRUE,FALSE),
  ('SEC0001','Security','Analyst','aic.admin0001@gmail.com','$2b$10$YGmxQqnECGWWi4fGIVKNaeAYf7mT9bqvBq5OxmN3Y5KXAiRh6I0Oq','admin','security','SEC','IT Security Analyst',TRUE,FALSE),
  ('HR0001','Human','Resource','aic.admin0001@gmail.com','$2b$10$YGmxQqnECGWWi4fGIVKNaeAYf7mT9bqvBq5OxmN3Y5KXAiRh6I0Oq','admin','hr','ADM','HR Manager',TRUE,FALSE)
ON CONFLICT DO NOTHING;

-- PATIENTS (registered by receptionist only)
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
  phone VARCHAR(20),
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
  insurance_provider VARCHAR(100),
  insurance_no VARCHAR(50),
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(200),
  email_token_expires TIMESTAMP,
  portal_password_hash VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  registered_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- PATIENT JOURNEY — tracks flow through departments
CREATE TABLE IF NOT EXISTS patient_journey (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_no VARCHAR(25) UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  visit_type VARCHAR(30) DEFAULT 'OPD' CHECK (visit_type IN ('OPD','Emergency','Follow-up','Inpatient')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','completed','discharged','referred')),
  current_dept CHAR(3) REFERENCES departments(code),
  started_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  chief_complaint TEXT
);
CREATE INDEX IF NOT EXISTS idx_journey_date ON patient_journey(visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_journey_patient ON patient_journey(patient_id);

-- JOURNEY STEPS — each dept records what they did (IMMUTABLE once submitted)
CREATE TABLE IF NOT EXISTS journey_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journey_id UUID NOT NULL REFERENCES patient_journey(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  step_no INTEGER NOT NULL,
  dept_code CHAR(3) REFERENCES departments(code),
  dept_name VARCHAR(100),
  recorded_by UUID REFERENCES staff(id),
  recorder_name VARCHAR(200),
  recorder_role VARCHAR(50),
  action VARCHAR(50) CHECK (action IN ('received','triaged','assessed','treated','forwarded','prescribed','dispensed','discharged','referred')),
  vitals JSONB,
  findings TEXT,
  treatment TEXT,
  next_dept CHAR(3) REFERENCES departments(code),
  notes TEXT,
  -- IMMUTABILITY
  submitted BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP,
  locked BOOLEAN DEFAULT FALSE,
  locked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_journey ON journey_steps(journey_id);

-- Lock step on submit
CREATE OR REPLACE FUNCTION lock_step_on_submit() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked = TRUE THEN
    RAISE EXCEPTION 'This step is locked and cannot be edited after submission';
  END IF;
  IF NEW.submitted = TRUE AND OLD.submitted = FALSE THEN
    NEW.submitted_at := NOW();
    NEW.locked := TRUE;
    NEW.locked_at := NOW();
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS step_lock_trigger ON journey_steps;
CREATE TRIGGER step_lock_trigger BEFORE UPDATE ON journey_steps FOR EACH ROW EXECUTE FUNCTION lock_step_on_submit();

-- DAILY REPORTS — mandatory, one per staff per day, IMMUTABLE once submitted
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_no VARCHAR(30) UNIQUE NOT NULL,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Author info
  staff_id UUID NOT NULL REFERENCES staff(id),
  staff_name VARCHAR(200) NOT NULL,
  dept_code CHAR(3) REFERENCES departments(code),
  dept_name VARCHAR(100),
  role VARCHAR(50),
  -- Content
  report_type VARCHAR(50) DEFAULT 'Daily' CHECK (report_type IN ('Daily','Clinical','Incident','Maintenance','Financial','HR','Security','Lab','Pharmacy','General')),
  title VARCHAR(300) NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  patients_seen INTEGER DEFAULT 0,
  incidents TEXT,
  challenges TEXT,
  recommendations TEXT,
  priority VARCHAR(20) DEFAULT 'Normal' CHECK (priority IN ('Low','Normal','High','Urgent')),
  is_confidential BOOLEAN DEFAULT FALSE,
  -- Admin review
  admin_review_status VARCHAR(20) DEFAULT 'Pending' CHECK (admin_review_status IN ('Pending','Reviewed','Acknowledged','Escalated')),
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMP,
  admin_notes TEXT,
  -- IMMUTABILITY
  status VARCHAR(20) DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted')),
  submitted_at TIMESTAMP,
  locked BOOLEAN DEFAULT FALSE,
  locked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- One submitted report per staff per day per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_report_per_day ON daily_reports(staff_id, report_date, report_type) WHERE status = 'Submitted';
CREATE INDEX IF NOT EXISTS idx_report_date ON daily_reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_report_staff ON daily_reports(staff_id);
CREATE INDEX IF NOT EXISTS idx_report_dept ON daily_reports(dept_code);

-- Lock report on submit (allows admin to review locked reports)
CREATE OR REPLACE FUNCTION lock_report_on_submit() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked = TRUE AND (
    NEW.admin_review_status IS DISTINCT FROM OLD.admin_review_status OR
    NEW.admin_notes IS DISTINCT FROM OLD.admin_notes OR
    NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
    NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
  ) THEN
    NULL;
  ELSIF OLD.locked = TRUE THEN
    RAISE EXCEPTION 'Report % is permanently locked — submitted reports cannot be edited', OLD.report_no;
  END IF;
  IF NEW.status = 'Submitted' AND OLD.status = 'Draft' THEN
    NEW.submitted_at := NOW();
    NEW.locked := TRUE;
    NEW.locked_at := NOW();
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS report_lock_trigger ON daily_reports;
CREATE TRIGGER report_lock_trigger BEFORE UPDATE ON daily_reports FOR EACH ROW EXECUTE FUNCTION lock_report_on_submit();

-- Add index for faster patient OTP lookups
CREATE INDEX IF NOT EXISTS idx_email_tokens_patient_lookup ON email_tokens(entity_id, token_type, used, expires_at);

-- ATTENDANCE — staff manually clock in/out via portal button
CREATE TABLE IF NOT EXISTS attendance_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  staff_code VARCHAR(8) NOT NULL,
  staff_name VARCHAR(200),
  dept_code CHAR(3),
  role VARCHAR(50),
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Clock In
  clock_in_time TIMESTAMP,
  clock_in_ip VARCHAR(50),
  -- Clock Out
  clock_out_time TIMESTAMP,
  clock_out_ip VARCHAR(50),
  -- Calculated
  duration_minutes INTEGER,
  status VARCHAR(20) DEFAULT 'Present' CHECK (status IN ('Present','Late','Absent','Half-Day','Leave')),
  is_late BOOLEAN DEFAULT FALSE,
  late_by_minutes INTEGER DEFAULT 0,
  -- Report tracker
  daily_report_submitted BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_att_staff_date ON attendance_log(staff_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_log(work_date DESC);

-- Auto-calculate late/duration
CREATE OR REPLACE FUNCTION calc_attendance_stats() RETURNS TRIGGER AS $$
DECLARE v_start TIME := '07:15:00';
BEGIN
  IF NEW.clock_in_time IS NOT NULL AND NEW.clock_out_time IS NOT NULL THEN
    NEW.duration_minutes := GREATEST(0, EXTRACT(EPOCH FROM (NEW.clock_out_time - NEW.clock_in_time))::INTEGER / 60);
  END IF;
  IF NEW.clock_in_time IS NOT NULL THEN
    IF NEW.clock_in_time::TIME > v_start THEN
      NEW.is_late := TRUE;
      NEW.late_by_minutes := GREATEST(0, EXTRACT(EPOCH FROM (NEW.clock_in_time::TIME - v_start))::INTEGER / 60);
      IF NEW.status NOT IN ('Leave') THEN NEW.status := 'Late'; END IF;
    ELSE
      NEW.is_late := FALSE; NEW.late_by_minutes := 0;
      IF NEW.status NOT IN ('Leave') THEN NEW.status := 'Present'; END IF;
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS att_calc_trigger ON attendance_log;
CREATE TRIGGER att_calc_trigger BEFORE INSERT OR UPDATE ON attendance_log FOR EACH ROW EXECUTE FUNCTION calc_attendance_stats();


-- APPOINTMENTS
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID REFERENCES staff(id),
  dept_code CHAR(3) REFERENCES departments(code),
  appointment_date DATE NOT NULL CHECK (
    appointment_date >= CURRENT_DATE
    AND appointment_date <= CURRENT_DATE + INTERVAL '6 months'
  ),
  appointment_time TIME NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'Scheduled' CHECK (
    status IN ('Scheduled','Confirmed','Completed','Cancelled','No-show')
  ),
  notes TEXT,
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- EMAIL TOKENS
CREATE TABLE IF NOT EXISTS email_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(20) CHECK (entity_type IN ('staff','patient')),
  entity_id UUID NOT NULL,
  email VARCHAR(200) NOT NULL,
  token VARCHAR(200) UNIQUE NOT NULL,
  token_type VARCHAR(30) CHECK (token_type IN ('verify_email','reset_password','login_otp')),
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_token ON email_tokens(token);

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id VARCHAR(100),
  actor_name VARCHAR(200),
  actor_role VARCHAR(50),
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(255),
  method VARCHAR(10),
  status_code INTEGER,
  ip_address VARCHAR(50),
  user_agent TEXT,
  details JSONB,
  severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  timestamp TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_sev ON audit_logs(severity);

-- SECURITY ALERTS
CREATE TABLE IF NOT EXISTS security_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  severity VARCHAR(20) CHECK (severity IN ('critical','high','medium','low')),
  category VARCHAR(100),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  source VARCHAR(100),
  source_ip VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved','dismissed')),
  acknowledged_by UUID REFERENCES staff(id),
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- NETWORK DEVICES
CREATE TABLE IF NOT EXISTS network_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mac_address VARCHAR(20) UNIQUE NOT NULL,
  device_name VARCHAR(200),
  ip_address VARCHAR(20),
  entity_type VARCHAR(20),
  vlan VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active',
  last_seen TIMESTAMP DEFAULT NOW(),
  registered_at TIMESTAMP DEFAULT NOW()
);

-- COMPLIANCE VIEW — who has/hasn't submitted today
CREATE OR REPLACE VIEW v_report_compliance AS
SELECT s.staff_id, s.first_name||' '||s.last_name AS name, s.dept_code, s.role,
  CASE WHEN dr.id IS NOT NULL THEN true ELSE false END AS submitted_today,
  dr.submitted_at, dr.report_no, dr.title
FROM staff s
LEFT JOIN daily_reports dr ON dr.staff_id=s.id AND dr.report_date=CURRENT_DATE AND dr.status='Submitted'
WHERE s.is_active=TRUE AND s.role!='admin'
ORDER BY s.dept_code, s.last_name;

-- ATTENDANCE VIEW
CREATE OR REPLACE VIEW v_today_attendance AS
SELECT s.staff_id AS code, s.first_name||' '||s.last_name AS name,
  s.dept_code, s.role,
  a.clock_in_time, a.clock_out_time, a.duration_minutes,
  a.status, a.is_late, a.late_by_minutes, a.daily_report_submitted,
  CASE WHEN a.id IS NULL THEN 'Absent' ELSE a.status END AS attendance_status
FROM staff s
LEFT JOIN attendance_log a ON a.staff_id=s.id AND a.work_date=CURRENT_DATE
WHERE s.is_active=TRUE AND s.role!='admin'
ORDER BY s.dept_code, s.last_name;

-- Seed alerts
INSERT INTO security_alerts (severity,category,title,description,source,source_ip,status) VALUES
  ('low','System','AIC Kapsowar HMS v7 Online',
   'Workflow engine active. Immutable reports and patient journey tracking enabled.',
   'System','127.0.0.1','acknowledged')
ON CONFLICT DO NOTHING;

-- ============================================================
-- AIC KAPSOWAR HMS v8 — EXTENDED SCHEMA
-- Leave, Pharmacy, Lab, Billing, Shifts, Notifications, EMR
-- ============================================================

-- LEAVE REQUESTS
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  staff_name VARCHAR(200) NOT NULL,
  staff_code VARCHAR(8),
  dept_code CHAR(3) REFERENCES departments(code),
  role VARCHAR(50),
  leave_type VARCHAR(30) NOT NULL CHECK (leave_type IN ('Annual','Sick','Emergency','Study','Maternity','Paternity','Compassionate','Unpaid')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_requested INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Denied','Cancelled')),
  admin_comment TEXT,
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_staff ON leave_requests(staff_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);

-- LEAVE BALANCES — tracks days used per year per type
CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
  leave_type VARCHAR(30) NOT NULL,
  days_entitled INTEGER DEFAULT 21,
  days_used INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(staff_id, year, leave_type)
);

-- DRUGS / PHARMACY INVENTORY
CREATE TABLE IF NOT EXISTS drugs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  generic_name VARCHAR(200),
  category VARCHAR(100) DEFAULT 'General',
  unit VARCHAR(50) DEFAULT 'Tablet',
  stock_qty INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 10,
  expiry_date DATE,
  unit_price NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drugs_name ON drugs(name);
CREATE INDEX IF NOT EXISTS idx_drugs_stock ON drugs(stock_qty);

-- PRESCRIPTIONS
CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  prescribed_by UUID REFERENCES staff(id),
  prescriber_name VARCHAR(200),
  prescriber_role VARCHAR(50),
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','Dispensed','Cancelled')),
  dispensed_by UUID REFERENCES staff(id),
  dispensed_at TIMESTAMP,
  dispensing_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presc_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_presc_status ON prescriptions(status);

-- LAB TESTS CATALOG
CREATE TABLE IF NOT EXISTS lab_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) DEFAULT 'General',
  unit VARCHAR(50),
  normal_range VARCHAR(100),
  price NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
-- Seed common lab tests
INSERT INTO lab_tests (name, category, unit, normal_range, price) VALUES
  ('Full Blood Count (FBC)', 'Haematology', 'Cells/μL', 'Variable', 500),
  ('Blood Sugar (Random)', 'Biochemistry', 'mmol/L', '3.9–7.8', 200),
  ('Blood Sugar (Fasting)', 'Biochemistry', 'mmol/L', '3.9–5.5', 200),
  ('Malaria RDT', 'Parasitology', 'Positive/Negative', 'Negative', 300),
  ('Malaria Film (Thick & Thin)', 'Parasitology', 'Positive/Negative', 'Negative', 400),
  ('HIV Test', 'Serology', 'Positive/Negative', 'Negative', 0),
  ('Urine Analysis', 'Urinalysis', 'Various', 'Normal', 200),
  ('Stool Analysis', 'Parasitology', 'Various', 'Normal', 250),
  ('Widal Test', 'Serology', 'Titre', '<1:80', 500),
  ('VDRL/RPR (Syphilis)', 'Serology', 'Positive/Negative', 'Negative', 400),
  ('Pregnancy Test (UPT)', 'Serology', 'Positive/Negative', 'Negative', 200),
  ('Liver Function Tests (LFT)', 'Biochemistry', 'U/L', 'Variable', 1500),
  ('Kidney Function Tests (KFT)', 'Biochemistry', 'mmol/L', 'Variable', 1500),
  ('Lipid Profile', 'Biochemistry', 'mmol/L', 'Variable', 1200),
  ('Thyroid Function (TSH)', 'Biochemistry', 'mIU/L', '0.4–4.0', 2000),
  ('Blood Group & Crossmatch', 'Blood Bank', 'Type', 'N/A', 500),
  ('ESR', 'Haematology', 'mm/hr', 'M:<15 F:<20', 300),
  ('HbA1C', 'Biochemistry', '%', '<5.7%', 1500),
  ('CD4 Count', 'Immunology', 'Cells/μL', '>500', 2500),
  ('Sputum AFB (TB)', 'Microbiology', 'Positive/Negative', 'Negative', 0)
ON CONFLICT DO NOTHING;

-- LAB REQUESTS
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
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Completed','Cancelled')),
  results JSONB,
  lab_notes TEXT,
  reported_by UUID REFERENCES staff(id),
  reporter_name VARCHAR(200),
  reported_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_patient ON lab_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_status ON lab_requests(status);

-- INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_no VARCHAR(30) UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  journey_id UUID REFERENCES patient_journey(id),
  items JSONB NOT NULL DEFAULT '[]',
  total_amount NUMERIC(12,2) DEFAULT 0,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  balance NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  status VARCHAR(20) DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Partial','Paid','Waived','Insurance')),
  insurance_provider VARCHAR(100),
  insurance_no VARCHAR(50),
  insurance_claim_status VARCHAR(20) DEFAULT 'None' CHECK (insurance_claim_status IN ('None','Submitted','Approved','Rejected')),
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount NUMERIC(12,2) NOT NULL,
  payment_method VARCHAR(30) DEFAULT 'Cash' CHECK (payment_method IN ('Cash','M-Pesa','Insurance','Card','Bank Transfer','Waiver')),
  reference VARCHAR(100),
  received_by UUID REFERENCES staff(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);

-- SHIFTS
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  shift_type VARCHAR(20) NOT NULL CHECK (shift_type IN ('Morning','Afternoon','Night','On-Call','Off')),
  shift_date DATE NOT NULL,
  week_start_date DATE,
  start_time TIME,
  end_time TIME,
  dept_code CHAR(3) REFERENCES departments(code),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(staff_id, shift_date, shift_type)
);
CREATE INDEX IF NOT EXISTS idx_shifts_staff ON shifts(staff_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);

-- NOTIFICATIONS (in-app alerts)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL,
  recipient_type VARCHAR(20) DEFAULT 'staff' CHECK (recipient_type IN ('staff','patient')),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info' CHECK (type IN ('info','success','warning','danger','leave','lab','pharmacy','billing','security')),
  action_url VARCHAR(300),
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read);

-- Helper function: create notification
CREATE OR REPLACE FUNCTION create_notification(
  p_recipient_id UUID, p_recipient_type VARCHAR, p_title VARCHAR,
  p_message TEXT, p_type VARCHAR, p_action_url VARCHAR DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO notifications(recipient_id,recipient_type,title,message,type,action_url)
  VALUES(p_recipient_id,p_recipient_type,p_title,p_message,p_type,p_action_url);
END; $$ LANGUAGE plpgsql;

-- Auto-notify staff when leave is reviewed
CREATE OR REPLACE FUNCTION notify_leave_review() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status != OLD.status AND NEW.status IN ('Approved','Denied') THEN
    PERFORM create_notification(
      NEW.staff_id, 'staff',
      CASE WHEN NEW.status='Approved' THEN 'Leave Approved' ELSE 'Leave Denied' END,
      'Your ' || NEW.leave_type || ' leave request (' || NEW.start_date || ' to ' || NEW.end_date || ') has been ' || LOWER(NEW.status) || '.',
      CASE WHEN NEW.status='Approved' THEN 'success' ELSE 'warning' END,
      'leave-requests.html'
    );
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS leave_review_notify ON leave_requests;
CREATE TRIGGER leave_review_notify AFTER UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION notify_leave_review();

-- Auto-notify when lab results are ready
CREATE OR REPLACE FUNCTION notify_lab_ready() RETURNS TRIGGER AS $$
DECLARE v_doc UUID;
BEGIN
  IF NEW.status = 'Completed' AND OLD.status != 'Completed' THEN
    SELECT requested_by INTO v_doc FROM lab_requests WHERE id = NEW.id;
    IF v_doc IS NOT NULL THEN
      PERFORM create_notification(
        v_doc, 'staff', '🔬 Lab Results Ready',
        'Lab results are ready for your patient. Check the lab module.',
        'lab', 'lab-results.html'
      );
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lab_ready_notify ON lab_requests;
CREATE TRIGGER lab_ready_notify AFTER UPDATE ON lab_requests FOR EACH ROW EXECUTE FUNCTION notify_lab_ready();

-- Low stock alert view
CREATE OR REPLACE VIEW v_low_stock_drugs AS
SELECT * FROM drugs WHERE stock_qty <= reorder_level AND is_active=TRUE ORDER BY stock_qty ASC;

-- Revenue summary view
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT DATE(created_at) as revenue_date,
  SUM(amount) as total_collected,
  COUNT(*) as transaction_count,
  SUM(CASE WHEN payment_method='Cash' THEN amount ELSE 0 END) as cash,
  SUM(CASE WHEN payment_method='M-Pesa' THEN amount ELSE 0 END) as mpesa,
  SUM(CASE WHEN payment_method='Insurance' THEN amount ELSE 0 END) as insurance
FROM payments GROUP BY DATE(created_at) ORDER BY revenue_date DESC;


-- ============================================================
-- v8.1 — Cross-Department Schema Additions
-- ============================================================

-- Add prescription_id link to journey_steps for traceability
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES prescriptions(id);
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS lab_request_id UUID REFERENCES lab_requests(id);

-- Add invoice_id to patient_journey so we can track billing per visit
ALTER TABLE patient_journey ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id);

-- Auto-notify pharmacy when new prescription arrives (belt+suspenders alongside route notification)
CREATE OR REPLACE FUNCTION notify_new_prescription() RETURNS TRIGGER AS $$
BEGIN
  -- Insert notification for all pharmacists
  INSERT INTO notifications(recipient_id, recipient_type, title, message, type, action_url)
  SELECT id, 'staff', '💊 New Prescription Waiting',
    'A new prescription has been created and is awaiting dispensing.',
    'pharmacy', 'pharmacy-dashboard.html'
  FROM staff WHERE role = 'pharmacist' AND is_active = TRUE;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS presc_notify ON prescriptions;
CREATE TRIGGER presc_notify AFTER INSERT ON prescriptions FOR EACH ROW EXECUTE FUNCTION notify_new_prescription();

-- Auto-notify receptionist/accountant when journey completes (belt+suspenders)
CREATE OR REPLACE FUNCTION notify_journey_complete() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('completed','discharged') AND OLD.status = 'active' THEN
    INSERT INTO notifications(recipient_id, recipient_type, title, message, type, action_url)
    SELECT id, 'staff', '💰 Patient Discharged — Bill Now',
      'Journey ' || NEW.journey_no || ' completed. Patient ready for billing.',
      'billing', 'finance-dashboard.html'
    FROM staff WHERE role IN ('receptionist','accountant') AND is_active = TRUE;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS journey_complete_notify ON patient_journey;
CREATE TRIGGER journey_complete_notify AFTER UPDATE ON patient_journey FOR EACH ROW EXECUTE FUNCTION notify_journey_complete();

-- View: full patient visit summary (used by patient portal + doctor EMR)
CREATE OR REPLACE VIEW v_patient_visit_summary AS
SELECT
  pj.id as journey_id,
  pj.journey_no,
  pj.patient_id,
  p.first_name || ' ' || p.last_name as patient_name,
  p.patient_id as pid,
  pj.visit_date,
  pj.visit_type,
  pj.status,
  pj.chief_complaint,
  pj.completed_at,
  (SELECT COUNT(*) FROM journey_steps js WHERE js.journey_id = pj.id) as step_count,
  (SELECT COUNT(*) FROM prescriptions pr WHERE pr.journey_id = pj.id) as prescription_count,
  (SELECT COUNT(*) FROM lab_requests lr WHERE lr.journey_id = pj.id) as lab_count,
  (SELECT COUNT(*) FROM invoices i WHERE i.journey_id = pj.id) as invoice_count,
  (SELECT SUM(total_amount) FROM invoices i WHERE i.journey_id = pj.id) as total_billed,
  (SELECT SUM(amount_paid) FROM invoices i WHERE i.journey_id = pj.id) as total_paid
FROM patient_journey pj
JOIN patients p ON p.id = pj.patient_id
ORDER BY pj.visit_date DESC;

-- View: dept communication dashboard — what each dept has pending
CREATE OR REPLACE VIEW v_dept_workload AS
SELECT
  'Pharmacy' as department,
  (SELECT COUNT(*) FROM prescriptions WHERE status='Pending') as pending_count,
  (SELECT COUNT(*) FROM prescriptions WHERE status='Pending' AND created_at > NOW()-INTERVAL '2 hours') as urgent_count
UNION ALL
SELECT
  'Laboratory',
  (SELECT COUNT(*) FROM lab_requests WHERE status='Pending'),
  (SELECT COUNT(*) FROM lab_requests WHERE status='Pending' AND urgency IN ('Urgent','STAT'))
UNION ALL
SELECT
  'Finance/Billing',
  (SELECT COUNT(*) FROM invoices WHERE status IN ('Unpaid','Partial')),
  (SELECT COUNT(*) FROM invoices WHERE status='Unpaid' AND created_at > NOW()-INTERVAL '24 hours')
UNION ALL
SELECT
  'Reception',
  (SELECT COUNT(*) FROM patient_journey WHERE status='active' AND current_dept='REC' AND visit_date=CURRENT_DATE),
  0
UNION ALL
SELECT
  'Triage',
  (SELECT COUNT(*) FROM patient_journey WHERE status='active' AND current_dept IN ('REC','TRG') AND visit_date=CURRENT_DATE),
  0;


-- ============================================================
-- Admin Profiles (private — visible only to the owner)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE UNIQUE,
  bio TEXT,
  responsibilities TEXT,
  office_location VARCHAR(100),
  direct_phone VARCHAR(20),
  signature_text VARCHAR(200),
  profile_photo_b64 TEXT,  -- base64 encoded, stored per admin
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_profile_staff ON admin_profiles(staff_id);
