/**
 * AIC Kapsowar HMS v9 — Notification Routes
 * GET /api/notifications        — get unread for logged-in user
 * POST /api/notifications/read  — mark as read
 * GET /api/notifications/count  — unread count (for badge)
 */

import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, rbacMiddleware } from '../middleware/auth.js';

const router = express.Router();

// ── GET ALL STAFF (admin view) ──────────────────────────
router.get('/all-staff', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT staff_id, first_name, middle_name, last_name, email, phone, dept_code, job_title, role, is_active, email_verified, created_at
       FROM staff ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET UNVERIFIED PATIENTS (admin view) ──────────────────────────
router.get('/unverified-patients', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT patient_id, first_name, last_name, email, phone, created_at, email_verified, is_active
       FROM patients 
       WHERE email_verified = false AND is_active = true
       ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET ALL PATIENTS (admin view) ──────────────────────────
router.get('/all-patients', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT patient_id, first_name, last_name, email, phone, created_at, email_verified, is_active
       FROM patients 
       ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET notifications for current user ──────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { id, role, patientId } = req.user;
    let rows;

    if (role === 'patient') {
      const r = await query(
        `SELECT * FROM notifications WHERE recipient_patient_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [patientId]
      );
      rows = r.rows;
    } else {
      const r = await query(
        `SELECT * FROM notifications WHERE recipient_staff_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [req.user.staffId]
      );
      rows = r.rows;
    }

    res.json({ notifications: rows, unread: rows.filter(n => !n.read).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET unread count (lightweight for badge polling) ────────────
router.get('/count', authMiddleware, async (req, res) => {
  try {
    const { role, staffId, patientId } = req.user;
    let r;
    if (role === 'patient') {
      r = await query(`SELECT COUNT(*) FROM notifications WHERE recipient_patient_id=$1 AND read=false`, [patientId]);
    } else {
      r = await query(`SELECT COUNT(*) FROM notifications WHERE recipient_staff_id=$1 AND read=false`, [staffId]);
    }
    res.json({ count: parseInt(r.rows[0].count) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MARK single notification as read ────────────────────────────
router.post('/:id/read', authMiddleware, async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET read=true, read_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MARK ALL as read ─────────────────────────────────────────────
router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    const { role, staffId, patientId } = req.user;
    if (role === 'patient') {
      await query(`UPDATE notifications SET read=true, read_at=NOW() WHERE recipient_patient_id=$1 AND read=false`, [patientId]);
    } else {
      await query(`UPDATE notifications SET read=true, read_at=NOW() WHERE recipient_staff_id=$1 AND read=false`, [staffId]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── RESEND VERIFICATION EMAIL TO STAFF (admin action) ─────────────────────
router.post('/resend-verification', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'Staff ID required' });

    const r = await query(`SELECT * FROM staff WHERE staff_id=$1`, [staffId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Staff not found' });

    const staff = r.rows[0];
    if (staff.email_verified) return res.status(400).json({ error: 'Email already verified' });
    if (!staff.email) return res.status(400).json({ error: 'No email on file' });

    // Generate new token
    const crypto = await import('crypto');
    const newToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(
      `UPDATE staff SET email_verification_token=$1, email_token_expires=$2 WHERE staff_id=$3`,
      [newToken, expires, staffId]
    );

    const { resendVerificationEmail } = await import('../services/notificationService.js');
    const sent = await resendVerificationEmail({
      staffId,
      email: staff.email,
      firstName: staff.first_name,
      newToken
    });

    res.json({ success: true, emailSent: sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── RESEND VERIFICATION EMAIL TO PATIENT (admin action) ─────────────────────
router.post('/resend-patient-verification', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'Patient ID required' });

    const r = await query(`SELECT * FROM patients WHERE patient_id=$1`, [patientId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Patient not found' });

    const patient = r.rows[0];
    if (patient.email_verified) return res.status(400).json({ error: 'Email already verified' });
    if (!patient.email) return res.status(400).json({ error: 'No email on file' });

    const crypto = await import('crypto');
    const newToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(
      `UPDATE patients SET email_verification_token=$1, email_token_expires=$2 WHERE patient_id=$3`,
      [newToken, expires, patientId]
    );

    const { resendPatientVerificationEmail } = await import('../services/notificationService.js');
    const sent = await resendPatientVerificationEmail({
      patientId,
      email: patient.email,
      firstName: patient.first_name,
      newToken
    });

    res.json({ success: true, emailSent: sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MANUALLY VERIFY PATIENT EMAIL (admin action - bypass email) ─────────────────────
router.post('/verify-patient-manual', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'Patient ID required' });

    const r = await query(`SELECT * FROM patients WHERE patient_id=$1`, [patientId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Patient not found' });

    const patient = r.rows[0];
    if (patient.email_verified) return res.status(400).json({ error: 'Email already verified' });

    await query(
      `UPDATE patients SET email_verified=true, email_verification_token=NULL, email_token_expires=NULL WHERE patient_id=$1`,
      [patientId]
    );

    res.json({ success: true, message: `${patientId} has been manually verified and can now log in` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE STAFF MEMBER (admin action) ─────────────────────
router.delete('/staff/:staffId', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const { staffId } = req.params;
    
    const r = await query(`SELECT * FROM staff WHERE staff_id=$1`, [staffId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Staff not found' });

    // Don't allow deleting yourself
    if (staffId === req.user.staffId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await query(`DELETE FROM staff WHERE staff_id=$1`, [staffId]);
    res.json({ success: true, message: `Staff member ${staffId} has been deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── UPDATE STAFF MEMBER (admin action) ─────────────────────
router.put('/staff/:staffId', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const { staffId } = req.params;
    const { firstName, lastName, email, phone, deptCode, jobTitle, role, isActive } = req.body;

    const r = await query(`SELECT * FROM staff WHERE staff_id=$1`, [staffId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Staff not found' });

    await query(
      `UPDATE staff SET 
        first_name = COALESCE(NULLIF($1,''), first_name),
        last_name = COALESCE(NULLIF($2,''), last_name),
        email = COALESCE(NULLIF($3,''), email),
        phone = COALESCE(NULLIF($4,''), phone),
        dept_code = COALESCE(NULLIF($5,''), dept_code),
        job_title = COALESCE(NULLIF($6,''), job_title),
        role = COALESCE(NULLIF($7,''), role),
        is_active = COALESCE($8, is_active),
        updated_at = NOW()
       WHERE staff_id=$9`,
      [firstName, lastName, email, phone, deptCode, jobTitle, role, isActive, staffId]
    );

    res.json({ success: true, message: `Staff member ${staffId} has been updated` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WARD / BED ENDPOINTS ─────────────────────────────────────────
router.get('/wards', authMiddleware, async (req, res) => {
  try {
    const r = await query(`
      SELECT w.*, 
        COUNT(b.id) FILTER (WHERE b.status='available') AS available_beds,
        COUNT(b.id) FILTER (WHERE b.status='occupied')  AS occupied_beds,
        COUNT(b.id) AS total_beds_actual
      FROM wards w LEFT JOIN beds b ON b.ward_id=w.id
      GROUP BY w.id ORDER BY w.name
    `);
    res.json({ wards: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/wards/:wardId/beds', authMiddleware, async (req, res) => {
  try {
    const r = await query(`
      SELECT b.*, p.first_name, p.last_name 
      FROM beds b LEFT JOIN patients p ON p.patient_id=b.patient_id
      WHERE b.ward_id=$1 ORDER BY b.bed_number
    `, [req.params.wardId]);
    res.json({ beds: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wards/admit', authMiddleware, async (req, res) => {
  try {
    const { patientId, wardId, bedNumber, diagnosis, notes } = req.body;
    const staffId = req.user.staffId;

    // Check bed available
    const bedR = await query(
      `SELECT * FROM beds WHERE ward_id=$1 AND bed_number=$2`,
      [wardId, bedNumber]
    );
    if (!bedR.rows.length) return res.status(404).json({ error: 'Bed not found' });
    if (bedR.rows[0].status === 'occupied') return res.status(409).json({ error: 'Bed already occupied' });

    await query(
      `UPDATE beds SET status='occupied', patient_id=$1, admitted_at=NOW(), admitted_by=$2, diagnosis=$3, notes=$4
       WHERE ward_id=$5 AND bed_number=$6`,
      [patientId, staffId, diagnosis, notes, wardId, bedNumber]
    );

    const wardR = await query(`SELECT name FROM wards WHERE id=$1`, [wardId]);
    const wardName = wardR.rows[0]?.name || 'Ward';

    const patR = await query(`SELECT first_name, last_name FROM patients WHERE patient_id=$1`, [patientId]);
    const patientName = patR.rows[0] ? `${patR.rows[0].first_name} ${patR.rows[0].last_name}` : patientId;

    const { notifyWardAdmission } = await import('../services/notificationService.js');
    await notifyWardAdmission({ patientId, patientName, wardName, bedNumber, admittedBy: staffId, diagnosis });

    res.json({ success: true, ward: wardName, bed: bedNumber });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wards/discharge', authMiddleware, async (req, res) => {
  try {
    const { patientId } = req.body;
    await query(
      `UPDATE beds SET status='available', patient_id=NULL, admitted_at=NULL, admitted_by=NULL, diagnosis=NULL, notes=NULL
       WHERE patient_id=$1`,
      [patientId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
