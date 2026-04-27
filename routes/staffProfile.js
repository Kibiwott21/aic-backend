/**
 * AIC HMS v9 — Staff Profile Routes
 * PUT  /api/staff/profile        — update own profile (bio, phone, office, responsibilities)
 * GET  /api/staff/unverified     — list unverified staff (admin only)
 * POST /api/staff/:id/verify-manual — manually verify staff email (admin only)
 */

import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, rbacMiddleware } from '../middleware/auth.js';

const router = express.Router();

// ── UPDATE OWN PROFILE ───────────────────────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { phone, office, bio, responsibilities } = req.body;
    const staffId = req.user.staffId;

    await query(
      `UPDATE staff SET 
        phone = COALESCE(NULLIF($1,''), phone),
        office = COALESCE(NULLIF($2,''), office),
        bio = COALESCE(NULLIF($3,''), bio),
        responsibilities = COALESCE(NULLIF($4,''), responsibilities),
        updated_at = NOW()
       WHERE staff_id = $5`,
      [phone || null, office || null, bio || null, responsibilities || null, staffId]
    );

    const r = await query(`SELECT * FROM staff WHERE staff_id=$1`, [staffId]);
    res.json({ success: true, staff: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET UNVERIFIED STAFF (admin only) ────────────────────────────
router.get('/unverified', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT staff_id, first_name, last_name, email, department, role, created_at
       FROM staff 
       WHERE email_verified = false AND is_active = true AND email IS NOT NULL
       ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MANUALLY VERIFY STAFF EMAIL (admin only) ─────────────────────
router.post('/:staffId/verify-manual', authMiddleware, rbacMiddleware('admin'), async (req, res) => {
  try {
    const { staffId } = req.params;
    await query(
      `UPDATE staff SET email_verified=true, email_verification_token=NULL, email_token_expires=NULL WHERE staff_id=$1`,
      [staffId]
    );
    res.json({ success: true, message: `${staffId} email manually verified` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADD PROFILE COLUMNS IF NOT EXIST (safe migration) ────────────
export async function ensureProfileColumns() {
  const cols = [
    ['office', 'VARCHAR(200)'],
    ['bio', 'TEXT'],
    ['responsibilities', 'TEXT']
  ];
  for (const [col, type] of cols) {
    try {
      await query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    } catch (e) {
      // Column already exists — ignore
    }
  }
}

export default router;
