-- AIC Kapsowar HMS v9 — Notifications Table Migration
-- Run this on your PostgreSQL aic_hms database

-- ── IN-APP NOTIFICATIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id                   SERIAL PRIMARY KEY,
  recipient_staff_id   VARCHAR(20) REFERENCES staff(staff_id) ON DELETE CASCADE,
  recipient_patient_id VARCHAR(20) REFERENCES patients(patient_id) ON DELETE CASCADE,
  type                 VARCHAR(50) NOT NULL,
  title                VARCHAR(200) NOT NULL,
  message              TEXT NOT NULL,
  link                 VARCHAR(500),
  priority             VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('normal','high','critical')),
  read                 BOOLEAN DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  read_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notif_staff    ON notifications(recipient_staff_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_patient  ON notifications(recipient_patient_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_type     ON notifications(type);

-- ── BEDS / WARD TRACKING ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wards (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  department  VARCHAR(20),
  total_beds  INT DEFAULT 20,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beds (
  id           SERIAL PRIMARY KEY,
  ward_id      INT REFERENCES wards(id),
  bed_number   VARCHAR(20) NOT NULL,
  status       VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available','occupied','maintenance')),
  patient_id   VARCHAR(20) REFERENCES patients(patient_id),
  admitted_at  TIMESTAMPTZ,
  admitted_by  VARCHAR(20) REFERENCES staff(staff_id),
  diagnosis    TEXT,
  notes        TEXT,
  UNIQUE(ward_id, bed_number)
);

CREATE INDEX IF NOT EXISTS idx_beds_ward   ON beds(ward_id, status);
CREATE INDEX IF NOT EXISTS idx_beds_patient ON beds(patient_id);

-- ── SEED WARDS ────────────────────────────────────────────────────
INSERT INTO wards (name, department, total_beds) VALUES
  ('General Ward A', 'INP', 20),
  ('General Ward B', 'INP', 20),
  ('Maternity Ward', 'MAT', 15),
  ('Paediatric Ward', 'PED', 15),
  ('Surgical Ward', 'SRG', 10),
  ('ICU', 'ICU', 6),
  ('Emergency Bay', 'EMG', 8)
ON CONFLICT (name) DO NOTHING;

-- Seed beds for General Ward A
DO $$
DECLARE w_id INT;
BEGIN
  SELECT id INTO w_id FROM wards WHERE name = 'General Ward A';
  FOR i IN 1..20 LOOP
    INSERT INTO beds (ward_id, bed_number, status)
    VALUES (w_id, 'GWA-' || LPAD(i::TEXT, 2, '0'), 'available')
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

COMMENT ON TABLE notifications IS 'AIC HMS v9 in-app and email notification log';
COMMENT ON TABLE beds IS 'Hospital bed tracking with ward assignments';
