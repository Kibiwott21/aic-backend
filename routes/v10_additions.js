// ── AIC HMS v10.1 — Additional Routes ────────────────────────────
// Import this in routes/index.js: import v10routes from './v10_additions.js';
// Then: router.use(v10routes);

import { Router } from 'express';
import { query } from '../config/database.js';
import { authMiddleware, rbacMiddleware } from '../middleware/auth.js';

const r = Router();

// ── DROPDOWNS ──────────────────────────────────────────────────
// Departments list for dropdowns
r.get('/dropdowns/departments', authMiddleware, async (req, res) => {
  try {
    const result = await query(`SELECT code, name FROM departments WHERE is_active=TRUE ORDER BY name`);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Staff list for dropdowns (optionally filtered)
r.get('/dropdowns/staff', authMiddleware, async (req, res) => {
  try {
    const { dept, role } = req.query;
    const conds = ['s.is_active=TRUE'];
    const params = [];
    if (dept) { params.push(dept); conds.push(`s.dept_code=$${params.length}`); }
    if (role) { params.push(role); conds.push(`s.role=$${params.length}`); }
    const result = await query(`SELECT s.id, s.staff_id, s.first_name, s.last_name, s.dept_code, s.role, s.job_title,
      d.name as dept_name FROM staff s LEFT JOIN departments d ON d.code=s.dept_code
      WHERE ${conds.join(' AND ')} ORDER BY s.first_name, s.last_name`, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STAFF PROFILE EDIT ─────────────────────────────────────────
r.put('/staff/profile', authMiddleware, async (req, res) => {
  try {
    const { phone, office_location, bio, signature_text } = req.body;
    const updates = []; const params = [];
    if (phone !== undefined) { params.push(phone); updates.push(`phone=$${params.length}`); }
    if (office_location !== undefined) { params.push(office_location); updates.push(`office_location=$${params.length}`); }
    if (bio !== undefined) { params.push(bio); updates.push(`bio=$${params.length}`); }
    if (signature_text !== undefined) { params.push(signature_text); updates.push(`signature_text=$${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.user.id);
    await query(`UPDATE staff SET ${updates.join(',')} WHERE id=$${params.length}`, params);
    res.json({ message: 'Profile updated' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── REPORT ROUTING ─────────────────────────────────────────────
// Get reports by reviewer role (what a manager sees in their queue)
r.get('/reports/my-review-queue', authMiddleware, async (req, res) => {
  try {
    const { status, date } = req.query;
    const conds = [`reviewer_role=$1`, `submitted=TRUE`];
    const params = [req.user.role];
    // CEO sees everything
    if (req.user.role === 'ceo' || req.user.role === 'admin') {
      conds.shift(); params.shift();
    }
    if (status) { params.push(status); conds.push(`status=$${params.length}`); }
    if (date) { params.push(date); conds.push(`report_date=$${params.length}`); }
    const result = await query(`SELECT dr.*, s.first_name||' '||s.last_name as staff_name, d.name as dept_name
      FROM daily_reports dr LEFT JOIN staff s ON s.id=dr.staff_id LEFT JOIN departments d ON d.code=dr.dept_code
      WHERE ${conds.length?conds.join(' AND '):'submitted=TRUE'} ORDER BY dr.created_at DESC LIMIT 100`, params);
    res.json({ reports: result.rows, total: result.rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Review a report (mark as reviewed)
r.put('/reports/:id/review', authMiddleware, async (req, res) => {
  try {
    const { feedback } = req.body;
    const rep = await query('SELECT * FROM daily_reports WHERE id=$1', [req.params.id]);
    if (!rep.rows.length) return res.status(404).json({ error: 'Report not found' });
    const report = rep.rows[0];
    // Validate reviewer has rights
    const canReview = req.user.role === 'ceo' || req.user.role === 'admin' || report.reviewer_role === req.user.role;
    if (!canReview) return res.status(403).json({ error: 'You are not authorized to review this report' });

    const r = await query(`UPDATE daily_reports SET status='Reviewed', reviewed_by=$1, reviewed_at=NOW(), admin_feedback=$2
      WHERE id=$3 RETURNING *`, [req.user.id, feedback||null, req.params.id]);

    // Notify the report author
    await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url) VALUES($1,'report',$2,$3,'my-reports.html')`,
      [report.staff_id, '✅ Report Reviewed', `Your ${report.report_date} report has been reviewed by ${req.user.name || 'your manager'}.${feedback?' Feedback: '+feedback:''}`]);

    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Escalate a report to CEO
r.put('/reports/:id/escalate', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Escalation reason is required' });
    const rep = await query('SELECT * FROM daily_reports WHERE id=$1', [req.params.id]);
    if (!rep.rows.length) return res.status(404).json({ error: 'Report not found' });

    await query(`UPDATE daily_reports SET escalated=TRUE, escalation_reason=$1, escalated_at=NOW(), escalated_by=$2, status='Escalated' WHERE id=$3`,
      [reason, req.user.id, req.params.id]);

    // Notify CEO
    const ceo = await query(`SELECT id FROM staff WHERE role IN ('ceo','admin') AND is_active=TRUE LIMIT 1`);
    if (ceo.rows.length) {
      await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url,priority) VALUES($1,'report','🚨 Report Escalated',$2,'admin-reports.html','urgent')`,
        [ceo.rows[0].id, `A report from ${rep.rows[0].dept_code} has been escalated by ${req.user.name||'a manager'}. Reason: ${reason}`]);
    }

    // Notify report author
    await query(`INSERT INTO notifications(recipient_id,type,title,message) VALUES($1,'report','⚠️ Your Report Escalated','Your report has been escalated to the CEO for review.')`,
      [rep.rows[0].staff_id]);

    res.json({ message: 'Report escalated to CEO' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark escalated report as actioned (CEO only)
r.put('/reports/:id/action', authMiddleware, rbacMiddleware('ceo','admin'), async (req, res) => {
  try {
    const { feedback } = req.body;
    await query(`UPDATE daily_reports SET status='Actioned', actioned_by=$1, actioned_at=NOW(), admin_feedback=$2 WHERE id=$3`,
      [req.user.id, feedback||null, req.params.id]);
    res.json({ message: 'Report actioned' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: VERIFY STAFF/PATIENTS ───────────────────────────────
r.put('/admin/staff/:id/verify', authMiddleware, rbacMiddleware('ceo','admin','hr_officer'), async (req, res) => {
  try {
    await query(`UPDATE staff SET email_verified=TRUE WHERE id=$1`, [req.params.id]);
    await query(`INSERT INTO audit_log(user_id,user_type,user_name,action,resource,resource_id) VALUES($1,'staff',$2,'manual_verify_staff','staff',$3)`,
      [req.user.id, req.user.name||'Admin', req.params.id]);
    res.json({ message: 'Staff verified' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

r.put('/admin/patients/:id/verify', authMiddleware, rbacMiddleware('ceo','admin','receptionist'), async (req, res) => {
  try {
    await query(`UPDATE patients SET email_verified=TRUE WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Patient verified' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VISITOR LOG (Security) ─────────────────────────────────────
r.post('/security/visitors', authMiddleware, async (req, res) => {
  try {
    const { visitor_name, id_no, phone, visiting_person, purpose } = req.body;
    if (!visitor_name || !id_no) return res.status(400).json({ error: 'Name and ID required' });
    const result = await query(`INSERT INTO visitor_log(visitor_name,id_no,phone,visiting_person,purpose,logged_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [visitor_name, id_no, phone||null, visiting_person||null, purpose||null, req.user.id]);
    res.status(201).json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

r.get('/security/visitors', authMiddleware, async (req, res) => {
  try {
    const { today } = req.query;
    const where = today ? `WHERE DATE(entry_time)=CURRENT_DATE` : '';
    const result = await query(`SELECT * FROM visitor_log ${where} ORDER BY entry_time DESC LIMIT 100`);
    res.json({ visitors: result.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── REPORTS: MY HISTORY ─────────────────────────────────────────
r.get('/daily-reports/my-history', authMiddleware, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM daily_reports WHERE staff_id=$1 ORDER BY report_date DESC LIMIT 30`, [req.user.id]);
    res.json({ reports: result.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

r.get('/daily-reports/today', authMiddleware, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM daily_reports WHERE staff_id=$1 AND report_date=CURRENT_DATE LIMIT 1`, [req.user.id]);
    res.json(result.rows[0] || { submitted: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

export default r;
