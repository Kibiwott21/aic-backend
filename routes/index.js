import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, rbacMiddleware, auditLog } from '../middleware/auth.js';
import {
  staffLogin, verifyStaffOTP, patientLogin, verifyPatientOTP,
  registerStaff, registerPatient, verifyEmail,
  requestPasswordReset, resetPassword, changePassword,
  getProfile, getBruteForceStatus
} from '../controllers/authController.js';
import { getAttackReport } from '../middleware/wifiControl.js';
import notificationsRouter from './notifications.js';

const router = express.Router();

// ── HEALTH ────────────────────────────────────────────────────
router.get('/health', (req,res) => res.json({ status:'ok', time: new Date().toISOString() }));

// ── AUTH ──────────────────────────────────────────────────────
router.post('/auth/staff/login', staffLogin);
router.post('/auth/staff/verify-otp', verifyStaffOTP);
router.post('/auth/patient/login', patientLogin);
router.post('/auth/patient/verify-otp', verifyPatientOTP);
router.post('/auth/register/staff', authMiddleware, rbacMiddleware('admin'), registerStaff);
router.post('/auth/register/patient', registerPatient);
router.get('/auth/verify-email', verifyEmail);
router.post('/auth/forgot-password', requestPasswordReset);
router.post('/auth/reset-password', resetPassword);
router.put('/auth/change-password', authMiddleware, changePassword);
router.get('/auth/profile', authMiddleware, getProfile);
router.get('/auth/brute-force-status', authMiddleware, rbacMiddleware('admin'), getBruteForceStatus);

// ── DASHBOARD STATS ───────────────────────────────────────────
router.get('/dashboard/stats', authMiddleware, async (req,res) => {
  try {
    const [pats, visits, todayAppts, activeAlerts, todayReports, submittedReports] = await Promise.all([
      query('SELECT COUNT(*) FROM patients WHERE is_active=TRUE'),
      query("SELECT COUNT(*) FROM patient_journey WHERE status='active' AND visit_date=CURRENT_DATE"),
      query("SELECT COUNT(*) FROM appointments WHERE appointment_date=CURRENT_DATE AND status NOT IN ('Cancelled','Completed')"),
      query("SELECT COUNT(*) FROM security_alerts WHERE status='active'"),
      query('SELECT COUNT(*) FROM daily_reports WHERE report_date=CURRENT_DATE'),
      query("SELECT COUNT(*) FROM daily_reports WHERE report_date=CURRENT_DATE AND status='Submitted'"),
    ]);
    const recentVisits = await query(`
      SELECT pj.*,p.first_name||' '||p.last_name as patient_name,p.patient_id
      FROM patient_journey pj JOIN patients p ON p.id=pj.patient_id
      ORDER BY pj.created_at DESC LIMIT 5`);
    res.json({
      totalPatients: parseInt(pats.rows[0].count),
      activeVisits: parseInt(visits.rows[0].count),
      todayAppointments: parseInt(todayAppts.rows[0].count),
      activeAlerts: parseInt(activeAlerts.rows[0].count),
      todayReports: parseInt(todayReports.rows[0].count),
      submittedReports: parseInt(submittedReports.rows[0].count),
      recentVisits: recentVisits.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATIENTS ──────────────────────────────────────────────────
router.get('/patients', authMiddleware, async (req,res) => {
  try {
    const { search='', page=1, limit=25 } = req.query;
    const off = (page-1)*limit;
    const p = search ? `%${search.toLowerCase()}%` : null;
    let r, cnt;
    if (p) {
      r = await query(`SELECT * FROM patients WHERE is_active=TRUE AND (LOWER(first_name||' '||last_name) LIKE $1 OR LOWER(patient_id) LIKE $1 OR phone LIKE $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,[p,limit,off]);
      cnt = await query(`SELECT COUNT(*) FROM patients WHERE is_active=TRUE AND (LOWER(first_name||' '||last_name) LIKE $1 OR LOWER(patient_id) LIKE $1 OR phone LIKE $1)`,[p]);
    } else {
      r = await query('SELECT * FROM patients WHERE is_active=TRUE ORDER BY created_at DESC LIMIT $1 OFFSET $2',[limit,off]);
      cnt = await query('SELECT COUNT(*) FROM patients WHERE is_active=TRUE');
    }
    res.json({ patients: r.rows, total: parseInt(cnt.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/patients/:id', authMiddleware, async (req,res) => {
  try {
    const r = await query('SELECT * FROM patients WHERE id=$1',[req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error:'Not found' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STAFF ─────────────────────────────────────────────────────
router.get('/staff', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { search='', role='', dept='' } = req.query;
    const conds = ['s.is_active=TRUE'];
    const params = [];
    if (search) { params.push(`%${search.toLowerCase()}%`); conds.push(`(LOWER(s.first_name||' '||s.last_name) LIKE $${params.length} OR LOWER(s.staff_id) LIKE $${params.length})`); }
    if (role)   { params.push(role);  conds.push(`s.role=$${params.length}`); }
    if (dept)   { params.push(dept);  conds.push(`s.dept_code=$${params.length}`); }
    const r = await query(`SELECT s.*,d.name as dept_name FROM staff s LEFT JOIN departments d ON d.code=s.dept_code WHERE ${conds.join(' AND ')} ORDER BY s.dept_code,s.last_name`,params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── APPOINTMENTS ──────────────────────────────────────────────
router.get('/appointments', authMiddleware, async (req,res) => {
  try {
    const { date, status, limit=100 } = req.query;
    const d = date || new Date().toISOString().slice(0,10);
    const conds = ['a.appointment_date=$1'];
    const params = [d];
    if (status) { params.push(status); conds.push(`a.status=$${params.length}`); }
    params.push(limit);
    const r = await query(`SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.patient_id as pid,
      s.first_name||' '||s.last_name as doctor_name FROM appointments a
      LEFT JOIN patients p ON p.id=a.patient_id LEFT JOIN staff s ON s.id=a.doctor_id
      WHERE ${conds.join(' AND ')} ORDER BY a.appointment_time LIMIT $${params.length}`,params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/appointments', authMiddleware, async (req,res) => {
  try {
    const { patientId,doctorId,deptCode,appointmentDate,appointmentTime,reason } = req.body;
    const r = await query(`INSERT INTO appointments(patient_id,doctor_id,dept_code,appointment_date,appointment_time,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[patientId,doctorId||null,deptCode||null,appointmentDate,appointmentTime,reason||null,req.user.id]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/appointments/:id', authMiddleware, async (req,res) => {
  try {
    const { status, notes } = req.body;
    const r = await query('UPDATE appointments SET status=$1,notes=COALESCE($2,notes) WHERE id=$3 RETURNING *',[status,notes||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ATTENDANCE — MANUAL CLOCK IN/OUT ──────────────────────────
router.get('/attendance/my-today', authMiddleware, async (req,res) => {
  try {
    const att = await query('SELECT * FROM attendance_log WHERE staff_id=$1 AND work_date=CURRENT_DATE',[req.user.id]);
    const rep = await query("SELECT id,report_no,title,status,submitted_at,locked FROM daily_reports WHERE staff_id=$1 AND report_date=CURRENT_DATE ORDER BY created_at DESC",[req.user.id]);
    res.json({
      attendance: att.rows[0]||null,
      hasClockedIn:  !!(att.rows[0]?.clock_in_time),
      hasClockedOut: !!(att.rows[0]?.clock_out_time),
      reports: rep.rows,
      hasSubmittedReport: rep.rows.some(r=>r.status==='Submitted')
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/attendance/clock-in', authMiddleware, async (req,res) => {
  try {
    const ip = (req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').slice(0,50);
    const s = await query('SELECT * FROM staff WHERE id=$1',[req.user.id]);
    const staff = s.rows[0];
    
    // Use UPSERT - insert or update on conflict
    const r = await query(
      `INSERT INTO attendance_log(staff_id,staff_code,staff_name,dept_code,role,work_date,clock_in_time,clock_in_ip)
       VALUES($1,$2,$3,$4,$5,CURRENT_DATE,NOW(),$6)
       ON CONFLICT (staff_id, work_date) DO UPDATE SET 
         clock_in_time = COALESCE(EXCLUDED.clock_in_time, attendance_log.clock_in_time),
         clock_in_ip = COALESCE(EXCLUDED.clock_in_ip, attendance_log.clock_in_ip),
         updated_at=NOW()
       WHERE attendance_log.clock_in_time IS NULL
       RETURNING *`,
      [req.user.id,staff.staff_id,`${staff.first_name} ${staff.last_name}`,staff.dept_code,staff.role,ip]
    );
    
    if (!r.rows.length) {
      // No rows returned means the WHERE clause filtered it out - already clocked in
      const existing = await query('SELECT clock_in_time FROM attendance_log WHERE staff_id=$1 AND work_date=CURRENT_DATE',[req.user.id]);
      return res.status(400).json({ error:'Already clocked in today', time: existing.rows[0]?.clock_in_time, alreadyClockedIn:true });
    }
    
    res.json({ message:'Clocked in successfully', record: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/attendance/clock-out', authMiddleware, async (req,res) => {
  try {
    const ip = (req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').slice(0,50);
    const ex = await query('SELECT * FROM attendance_log WHERE staff_id=$1 AND work_date=CURRENT_DATE',[req.user.id]);
    if (!ex.rows.length || !ex.rows[0].clock_in_time) return res.status(400).json({ error:'You have not clocked in today' });
    if (ex.rows[0].clock_out_time) return res.status(400).json({ error:'Already clocked out today', alreadyClockedOut:true });
    const r = await query('UPDATE attendance_log SET clock_out_time=NOW(),clock_out_ip=$1,updated_at=NOW() WHERE staff_id=$2 AND work_date=CURRENT_DATE AND clock_out_time IS NULL RETURNING *',[ip,req.user.id]);
    if (!r.rows.length) {
      return res.status(400).json({ error:'Already clocked out today', alreadyClockedOut:true });
    }
    res.json({ message:'Clocked out successfully', record: r.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/attendance/daily', authMiddleware, async (req,res) => {
  try {
    const { date } = req.query;
    const d = date || new Date().toISOString().slice(0,10);
    const present = await query(`SELECT a.*,s.email FROM attendance_log a JOIN staff s ON s.id=a.staff_id WHERE a.work_date=$1 ORDER BY a.dept_code,a.staff_name`,[d]);
    const absent = await query(`SELECT s.staff_id,s.first_name||' '||s.last_name as name,s.dept_code,s.role,s.email FROM staff s WHERE s.is_active=TRUE AND s.role!='admin' AND s.id NOT IN(SELECT staff_id FROM attendance_log WHERE work_date=$1) ORDER BY s.dept_code,s.last_name`,[d]);
    res.json({ present: present.rows, absent: absent.rows, date: d,
      summary:{ present: present.rows.filter(x=>!x.is_late).length, late: present.rows.filter(x=>x.is_late).length, absent: absent.rows.length }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DAILY REPORTS ─────────────────────────────────────────────
// My reports today
router.get('/reports/my-today', authMiddleware, async (req,res) => {
  try {
    const r = await query("SELECT * FROM daily_reports WHERE staff_id=$1 AND report_date=CURRENT_DATE ORDER BY created_at DESC",[req.user.id]);
    res.json({ reports: r.rows, hasSubmitted: r.rows.some(x=>x.status==='Submitted') });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// My all reports
router.get('/reports/my', authMiddleware, async (req,res) => {
  try {
    const { page=1, limit=30 } = req.query;
    const off=(page-1)*limit;
    const r = await query('SELECT * FROM daily_reports WHERE staff_id=$1 ORDER BY report_date DESC,created_at DESC LIMIT $2 OFFSET $3',[req.user.id,limit,off]);
    const c = await query('SELECT COUNT(*) FROM daily_reports WHERE staff_id=$1',[req.user.id]);
    res.json({ reports: r.rows, total: parseInt(c.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create new report (draft)
router.post('/reports', authMiddleware, async (req,res) => {
  try {
    const { title, summary, details, reportType, priority, patientsSeen, incidents, challenges, recommendations, isConfidential } = req.body;
    if (!title||!summary) return res.status(400).json({ error:'Title and summary are required' });
    const s = await query('SELECT s.*,d.name as dept_name FROM staff s LEFT JOIN departments d ON d.code=s.dept_code WHERE s.id=$1',[req.user.id]);
    const staff = s.rows[0];
    const rNo = `RPT-${staff.dept_code}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
    const r = await query(
      `INSERT INTO daily_reports(report_no,report_date,staff_id,staff_name,dept_code,dept_name,role,report_type,title,summary,details,patients_seen,incidents,challenges,recommendations,priority,is_confidential,status)
       VALUES($1,CURRENT_DATE,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Draft') RETURNING *`,
      [rNo,req.user.id,`${staff.first_name} ${staff.last_name}`,staff.dept_code,staff.dept_name,staff.role,
       reportType||'Daily',title,summary,details||null,parseInt(patientsSeen)||0,
       incidents||null,challenges||null,recommendations||null,priority||'Normal',isConfidential||false]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update draft (only if not locked)
router.put('/reports/:id', authMiddleware, async (req,res) => {
  try {
    const check = await query('SELECT locked,staff_id FROM daily_reports WHERE id=$1',[req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error:'Not found' });
    if (check.rows[0].locked) return res.status(400).json({ error:'This report is submitted and permanently locked. No edits allowed.', locked:true });
    if (check.rows[0].staff_id !== req.user.id) return res.status(403).json({ error:'Not your report' });
    const { title, summary, details, reportType, priority, patientsSeen, incidents, challenges, recommendations } = req.body;
    const r = await query(
      `UPDATE daily_reports SET title=$1,summary=$2,details=$3,report_type=$4,priority=$5,patients_seen=$6,incidents=$7,challenges=$8,recommendations=$9,updated_at=NOW()
       WHERE id=$10 AND staff_id=$11 AND locked=FALSE RETURNING *`,
      [title,summary,details||null,reportType||'Daily',priority||'Normal',parseInt(patientsSeen)||0,incidents||null,challenges||null,recommendations||null,req.params.id,req.user.id]
    );
    res.json(r.rows[0]);
  } catch(e) {
    if (e.message?.includes('locked')) return res.status(400).json({ error:e.message, locked:true });
    res.status(500).json({ error: e.message });
  }
});

// Submit & lock report permanently
router.put('/reports/:id/submit', authMiddleware, async (req,res) => {
  try {
    const check = await query('SELECT * FROM daily_reports WHERE id=$1 AND staff_id=$2',[req.params.id,req.user.id]);
    if (!check.rows.length) return res.status(404).json({ error:'Report not found or not yours' });
    if (check.rows[0].locked) return res.status(400).json({ error:'Already submitted and locked', locked:true });
    const r = await query("UPDATE daily_reports SET status='Submitted',updated_at=NOW() WHERE id=$1 AND staff_id=$2 AND locked=FALSE RETURNING *",[req.params.id,req.user.id]);
    if (!r.rows.length) return res.status(400).json({ error:'Could not submit — may already be locked' });
    // Mark attendance as having submitted report
    await query("UPDATE attendance_log SET daily_report_submitted=TRUE,updated_at=NOW() WHERE staff_id=$1 AND work_date=CURRENT_DATE",[req.user.id]).catch(()=>{});
    res.json({ message:'Report submitted and permanently locked. No further edits are possible.', report: r.rows[0] });
  } catch(e) {
    if (e.message?.includes('locked')) return res.status(400).json({ error:e.message, locked:true });
    res.status(500).json({ error: e.message });
  }
});

// Admin: all reports with compliance
router.get('/reports/all', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { date, dept, status, page=1, limit=50 } = req.query;
    const d = date || new Date().toISOString().slice(0,10);
    const conds=['report_date=$1']; const params=[d]; let pi=1;
    if (dept)   { params.push(dept);   pi++; conds.push(`dept_code=$${pi}`); }
    if (status) { params.push(status); pi++; conds.push(`status=$${pi}`); }
    const off=(page-1)*limit; params.push(limit,off); pi+=2;
    const r = await query(`SELECT * FROM daily_reports WHERE ${conds.join(' AND ')} ORDER BY dept_code,staff_name,created_at DESC LIMIT $${pi-1} OFFSET $${pi}`,params);
    const compliance = await query('SELECT * FROM v_report_compliance');
    res.json({ reports: r.rows, compliance: compliance.rows, total: r.rowCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: review report
router.put('/reports/:id/review', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { adminReviewStatus, adminNotes } = req.body;
    const r = await query('UPDATE daily_reports SET admin_review_status=$1,admin_notes=$2,reviewed_by=$3,reviewed_at=NOW() WHERE id=$4 RETURNING *',[adminReviewStatus||'Reviewed',adminNotes||null,req.user.id,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get single report by ID
router.get('/reports/:id', authMiddleware, async (req,res) => {
  try {
    const r = await query('SELECT * FROM daily_reports WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Report not found' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Add comment to report
router.put('/reports/:id/comment', authMiddleware, async (req,res) => {
  try {
    const { comment } = req.body;
    const r = await query('UPDATE daily_reports SET admin_notes=COALESCE(admin_notes || E\'\\n\',\'\') || $1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3 RETURNING *', [comment||'', req.user.id, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update report status (for admin review actions)
router.put('/reports/:id/status', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { status } = req.body;
    if (!['Reviewed','Acknowledged','Escalated'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const r = await query('UPDATE daily_reports SET admin_review_status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3 RETURNING *', [status, req.user.id, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATIENT JOURNEY ────────────────────────────────────────────
// Start journey (receptionist only)
router.post('/journey/start', authMiddleware, async (req,res) => {
  try {
    if (!['receptionist','admin'].includes(req.user.role)) return res.status(403).json({ error:'Only receptionists can start a patient journey' });
    const { patientId, visitType, chiefComplaint } = req.body;
    const jNo = `JRN-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const r = await query(`INSERT INTO patient_journey(journey_no,patient_id,visit_date,visit_type,current_dept,started_by,chief_complaint) VALUES($1,$2,CURRENT_DATE,$3,'REC',$4,$5) RETURNING *`,[jNo,patientId,visitType||'OPD',req.user.id,chiefComplaint||null]);
    // Auto-add reception step
    const staff = await query('SELECT * FROM staff WHERE id=$1',[req.user.id]);
    const st = staff.rows[0];
    await query(`INSERT INTO journey_steps(journey_id,patient_id,step_no,dept_code,dept_name,recorded_by,recorder_name,recorder_role,action,findings,notes) VALUES($1,$2,1,'REC','Reception',$3,$4,$5,'received',$6,'Patient admitted at reception')`,[r.rows[0].id,patientId,req.user.id,`${st.first_name} ${st.last_name}`,st.role,chiefComplaint||'Patient arrived']);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Active journeys today
router.get('/journey/active', authMiddleware, async (req,res) => {
  try {
    const r = await query(`SELECT pj.*,p.first_name||' '||p.last_name as patient_name,p.patient_id as pid,p.phone,p.blood_group,p.allergies,
      (SELECT COUNT(*) FROM journey_steps WHERE journey_id=pj.id) as step_count,
      (SELECT dept_name FROM journey_steps WHERE journey_id=pj.id ORDER BY step_no DESC LIMIT 1) as last_dept_name
      FROM patient_journey pj JOIN patients p ON p.id=pj.patient_id
      WHERE pj.status='active' AND pj.visit_date=CURRENT_DATE ORDER BY pj.created_at DESC`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get journey with all steps
router.get('/journey/:id', authMiddleware, async (req,res) => {
  try {
    const j = await query(`SELECT pj.*,p.first_name||' '||p.last_name as patient_name,p.patient_id as pid,p.blood_group,p.allergies,p.chronic_conditions,p.date_of_birth,p.gender,p.phone FROM patient_journey pj JOIN patients p ON p.id=pj.patient_id WHERE pj.id=$1`,[req.params.id]);
    const steps = await query('SELECT * FROM journey_steps WHERE journey_id=$1 ORDER BY step_no ASC',[req.params.id]);
    res.json({ journey: j.rows[0], steps: steps.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Add step to journey
router.post('/journey/:id/step', authMiddleware, async (req,res) => {
  try {
    const { action, findings, treatment, vitals, nextDept, notes } = req.body;
    const j = await query('SELECT * FROM patient_journey WHERE id=$1',[req.params.id]);
    if (!j.rows.length) return res.status(404).json({ error:'Journey not found' });
    const s = await query('SELECT s.*,d.name as dept_name FROM staff s LEFT JOIN departments d ON d.code=s.dept_code WHERE s.id=$1',[req.user.id]);
    const staff = s.rows[0];
    const lastStep = await query('SELECT MAX(step_no) as mx FROM journey_steps WHERE journey_id=$1',[req.params.id]);
    const stepNo = (parseInt(lastStep.rows[0].mx)||0)+1;
    const r = await query(
      `INSERT INTO journey_steps(journey_id,patient_id,step_no,dept_code,dept_name,recorded_by,recorder_name,recorder_role,action,findings,treatment,vitals,next_dept,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) RETURNING *`,
      [req.params.id,j.rows[0].patient_id,stepNo,staff.dept_code,staff.dept_name,req.user.id,`${staff.first_name} ${staff.last_name}`,staff.role,action,findings||null,treatment||null,vitals?JSON.stringify(vitals):null,nextDept||null,notes||null]
    );
    if (nextDept) await query('UPDATE patient_journey SET current_dept=$1 WHERE id=$2',[nextDept,req.params.id]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Submit & lock step
router.put('/journey/step/:stepId/submit', authMiddleware, async (req,res) => {
  try {
    const check = await query('SELECT * FROM journey_steps WHERE id=$1',[req.params.stepId]);
    if (!check.rows.length) return res.status(404).json({ error:'Step not found' });
    if (check.rows[0].locked) return res.status(400).json({ error:'Step already submitted and locked', locked:true });
    const r = await query("UPDATE journey_steps SET submitted=TRUE WHERE id=$1 AND locked=FALSE RETURNING *",[req.params.stepId]);
    res.json({ message:'Step submitted and permanently locked', step: r.rows[0] });
  } catch(e) {
    if (e.message?.includes('locked')) return res.status(400).json({ error:e.message, locked:true });
    res.status(500).json({ error: e.message });
  }
});

// Complete/discharge journey
router.put('/journey/:id/complete', authMiddleware, async (req,res) => {
  try {
    const { status } = req.body;
    const r = await query("UPDATE patient_journey SET status=$1,completed_at=NOW() WHERE id=$2 RETURNING *",[status||'completed',req.params.id]);
    const journey = r.rows[0];
    // Get patient info for notifications
    const pat = await query(`SELECT p.first_name||' '||p.last_name as name, p.insurance_provider FROM patients p WHERE p.id=$1`,[journey.patient_id]);
    const patName = pat.rows[0]?.name || 'Patient';
    const hasInsurance = !!pat.rows[0]?.insurance_provider;
    // Notify all receptionists/accountants that patient is ready for billing
    const frontDesk = await query("SELECT id FROM staff WHERE role IN ('receptionist','accountant') AND is_active=TRUE");
    for (const staff of frontDesk.rows) {
      await query(`INSERT INTO notifications(recipient_id,recipient_type,title,message,type,action_url) VALUES($1,'staff',$2,$3,'billing','finance-dashboard.html')`,
        [staff.id, `💰 Patient Ready for Billing`, `${patName} has been discharged (Journey: ${journey.journey_no}). Please create invoice.${hasInsurance?' Insurance: '+pat.rows[0].insurance_provider:''}`]
      ).catch(()=>{});
    }
    res.json(journey);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUDIT LOGS ─────────────────────────────────────────────────
router.get('/audit-logs', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { page=1, limit=50, severity } = req.query;
    const off=(page-1)*limit;
    const conds=[]; const params=[];
    if (severity) { params.push(severity); conds.push(`severity=$${params.length}`); }
    params.push(limit,off);
    const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
    const r = await query(`SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    const c = await query(`SELECT COUNT(*) FROM audit_logs ${where}`,params.slice(0,-2));
    res.json({ logs: r.rows, total: parseInt(c.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SECURITY ALERTS ────────────────────────────────────────────
router.get('/security-alerts', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const r = await query('SELECT * FROM security_alerts ORDER BY created_at DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/security-alerts/:id', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { status } = req.body;
    const r = await query('UPDATE security_alerts SET status=$1,acknowledged_by=$2,acknowledged_at=NOW() WHERE id=$3 RETURNING *',[status,req.user.id,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── NETWORK DEVICES ────────────────────────────────────────────
router.get('/network-devices', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const r = await query('SELECT * FROM network_devices ORDER BY last_seen DESC');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ATTACK REPORT ──────────────────────────────────────────────
router.get('/security/attack-report', authMiddleware, rbacMiddleware('admin'), getAttackReport);

// ── STAFF MANAGEMENT (edit, deactivate, reset password) ────────
router.put('/staff/:id', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { firstName, lastName, middleName, phone, deptCode, jobTitle, role, isActive, adminType } = req.body;
    const r = await query(`UPDATE staff SET first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
      middle_name=COALESCE($3,middle_name), phone=COALESCE($4,phone), dept_code=COALESCE($5,dept_code),
      job_title=COALESCE($6,job_title), role=COALESCE($7,role), is_active=COALESCE($8,is_active),
      admin_type=COALESCE($9,admin_type), updated_at=NOW() WHERE id=$10 RETURNING *`,
      [firstName||null,lastName||null,middleName||null,phone||null,deptCode||null,
       jobTitle||null,role||null,isActive??null,adminType||null,req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/staff/:id/reset-password', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
<<<<<<< HEAD
    const bcrypt = (await import('bcrypt')).default;
=======
    const bcrypt = (await import('bcryptjs')).default;
>>>>>>> 82282e34a8288fccb7ed8f89834e7fa77ec9eba8
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE staff SET password_hash=$1, must_change_password=TRUE, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
    res.json({ message: 'Password reset. Staff must change on next login.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEAVE MANAGEMENT ──────────────────────────────────────────
// Staff: submit leave request
router.post('/leave', authMiddleware, async (req,res) => {
  try {
    const { leaveType, startDate, endDate, reason } = req.body;
    if (!leaveType||!startDate||!endDate||!reason) return res.status(400).json({ error: 'All fields required' });
    const days = Math.ceil((new Date(endDate)-new Date(startDate))/(1000*60*60*24))+1;
    const s = await query('SELECT staff_id,first_name,last_name,dept_code,role FROM staff WHERE id=$1',[req.user.id]);
    const st = s.rows[0];
    const r = await query(`INSERT INTO leave_requests(staff_id,staff_name,staff_code,dept_code,role,leave_type,start_date,end_date,days_requested,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id,`${st.first_name} ${st.last_name}`,st.staff_id,st.dept_code,st.role,
       leaveType,startDate,endDate,days,reason]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Staff: my leave requests
router.get('/leave/my', authMiddleware, async (req,res) => {
  try {
    const r = await query('SELECT * FROM leave_requests WHERE staff_id=$1 ORDER BY created_at DESC',[req.user.id]);
    const bal = await query('SELECT * FROM leave_balances WHERE staff_id=$1 AND year=EXTRACT(YEAR FROM NOW())',[req.user.id]);
    res.json({ requests: r.rows, balances: bal.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: all leave requests
router.get('/leave/all', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { status, dept } = req.query;
    const conds=[]; const params=[];
    if (status) { params.push(status); conds.push(`status=$${params.length}`); }
    if (dept)   { params.push(dept);   conds.push(`dept_code=$${params.length}`); }
    const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
    const r = await query(`SELECT * FROM leave_requests ${where} ORDER BY created_at DESC`,params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: approve/deny leave
router.put('/leave/:id/review', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { status, adminComment } = req.body;
    if (!['Approved','Denied'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const r = await query(`UPDATE leave_requests SET status=$1, admin_comment=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$4 RETURNING *`,
      [status, adminComment||null, req.user.id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    // If approved, deduct from balance
    if (status === 'Approved') {
      const lr = r.rows[0];
      await query(`INSERT INTO leave_balances(staff_id,year,leave_type,days_used)
        VALUES($1,EXTRACT(YEAR FROM NOW()),$2,$3)
        ON CONFLICT(staff_id,year,leave_type) DO UPDATE SET days_used=leave_balances.days_used+$3`,
        [lr.staff_id, lr.leave_type, lr.days_requested]);
    }
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PHARMACY ──────────────────────────────────────────────────
// Get drug inventory
router.get('/pharmacy/drugs', authMiddleware, async (req,res) => {
  try {
    const { search='' } = req.query;
    const p = search ? [`%${search.toLowerCase()}%`] : [];
    const where = search ? `WHERE LOWER(name) LIKE $1 OR LOWER(generic_name) LIKE $1` : '';
    const r = await query(`SELECT * FROM drugs ${where} ORDER BY name`, p);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Add/update drug stock
router.post('/pharmacy/drugs', authMiddleware, rbacMiddleware('admin','pharmacist'), async (req,res) => {
  try {
    const { name, genericName, category, unit, stockQty, reorderLevel, expiryDate, unitPrice } = req.body;
    const r = await query(`INSERT INTO drugs(name,generic_name,category,unit,stock_qty,reorder_level,expiry_date,unit_price)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name,genericName||null,category||'General',unit||'Tablet',stockQty||0,reorderLevel||10,expiryDate||null,unitPrice||0]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/pharmacy/drugs/:id', authMiddleware, rbacMiddleware('admin','pharmacist'), async (req,res) => {
  try {
    const { stockQty, reorderLevel, unitPrice, expiryDate } = req.body;
    const r = await query(`UPDATE drugs SET stock_qty=COALESCE($1,stock_qty), reorder_level=COALESCE($2,reorder_level),
      unit_price=COALESCE($3,unit_price), expiry_date=COALESCE($4,expiry_date), updated_at=NOW() WHERE id=$5 RETURNING *`,
      [stockQty??null, reorderLevel??null, unitPrice??null, expiryDate||null, req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create prescription (doctor)
router.post('/pharmacy/prescriptions', authMiddleware, async (req,res) => {
  try {
    const { patientId, journeyId, items, notes } = req.body;
    if (!patientId||!items?.length) return res.status(400).json({ error: 'Patient and items required' });
    const s = await query('SELECT first_name,last_name,role,dept_code FROM staff WHERE id=$1',[req.user.id]);
    const st = s.rows[0];
    const r = await query(`INSERT INTO prescriptions(patient_id,journey_id,prescribed_by,prescriber_name,prescriber_role,items,notes)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
      [patientId, journeyId||null, req.user.id, `${st.first_name} ${st.last_name}`, st.role, JSON.stringify(items), notes||null]);
    // Notify all pharmacists
    const pharmacists = await query("SELECT id FROM staff WHERE role='pharmacist' AND is_active=TRUE");
    const s2 = await query('SELECT first_name,last_name FROM staff WHERE id=$1',[req.user.id]);
    const docName = s2.rows[0] ? `${s2.rows[0].first_name} ${s2.rows[0].last_name}` : 'Doctor';
    const patInfo = await query('SELECT first_name,last_name FROM patients WHERE id=$1',[patientId]);
    const pName = patInfo.rows[0] ? `${patInfo.rows[0].first_name} ${patInfo.rows[0].last_name}` : 'Patient';
    for (const ph of pharmacists.rows) {
      await query(`INSERT INTO notifications(recipient_id,recipient_type,title,message,type,action_url) VALUES($1,'staff',$2,$3,'pharmacy','pharmacy-dashboard.html')`,
        [ph.id, '💊 New Prescription', `Dr. ${docName} has written a prescription for ${pName}. ${items.length} item(s) ready for dispensing.`]
      ).catch(()=>{});
    }
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get pending prescriptions for pharmacy
router.get('/pharmacy/prescriptions', authMiddleware, async (req,res) => {
  try {
    const { status='Pending' } = req.query;
    const r = await query(`SELECT pr.*, p.first_name||' '||p.last_name as patient_name, p.patient_id as pid
      FROM prescriptions pr JOIN patients p ON p.id=pr.patient_id
      WHERE pr.status=$1 ORDER BY pr.created_at DESC`,[status]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dispense prescription
router.put('/pharmacy/prescriptions/:id/dispense', authMiddleware, rbacMiddleware('pharmacist','admin'), async (req,res) => {
  try {
    const { dispensingNotes } = req.body;
    const pres = await query('SELECT * FROM prescriptions WHERE id=$1',[req.params.id]);
    if (!pres.rows.length) return res.status(404).json({ error: 'Not found' });
    if (pres.rows[0].status === 'Dispensed') return res.status(400).json({ error: 'Already dispensed' });
    const items = pres.rows[0].items;
    // Deduct stock for each drug
    for (const item of items) {
      if (item.drugId) {
        await query('UPDATE drugs SET stock_qty=GREATEST(0,stock_qty-$1), updated_at=NOW() WHERE id=$2',
          [item.quantity||1, item.drugId]).catch(()=>{});
      }
    }
    const r = await query(`UPDATE prescriptions SET status='Dispensed', dispensed_by=$1, dispensed_at=NOW(),
      dispensing_notes=$2 WHERE id=$3 RETURNING *`,
      [req.user.id, dispensingNotes||null, req.params.id]);
    const dispensed = r.rows[0];
    // Notify prescribing doctor
    if (dispensed.prescribed_by) {
      const patD = await query('SELECT first_name,last_name FROM patients WHERE id=$1',[dispensed.patient_id]).catch(()=>({rows:[]}));
      const pdnm = patD.rows[0] ? `${patD.rows[0].first_name} ${patD.rows[0].last_name}` : 'your patient';
      await query(`INSERT INTO notifications(recipient_id,recipient_type,title,message,type,action_url) VALUES($1,'staff','✅ Prescription Dispensed',$2,'pharmacy','doctor-dashboard.html')`,
        [dispensed.prescribed_by, `Prescription for ${pdnm} has been dispensed by pharmacy.`]
      ).catch(()=>{});
    }
    res.json(dispensed);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LABORATORY ─────────────────────────────────────────────────
// Get test catalog
router.get('/lab/tests', authMiddleware, async (req,res) => {
  try {
    const r = await query('SELECT * FROM lab_tests ORDER BY category, name');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Request lab tests (doctor)
router.post('/lab/requests', authMiddleware, async (req,res) => {
  try {
    const { patientId, journeyId, tests, urgency, clinicalNotes } = req.body;
    if (!patientId||!tests?.length) return res.status(400).json({ error: 'Patient and tests required' });
    const s = await query('SELECT first_name,last_name,role FROM staff WHERE id=$1',[req.user.id]);
    const st = s.rows[0];
    const r = await query(`INSERT INTO lab_requests(patient_id,journey_id,requested_by,requester_name,requester_role,tests,urgency,clinical_notes)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
      [patientId, journeyId||null, req.user.id, `${st.first_name} ${st.last_name}`, st.role,
       JSON.stringify(tests), urgency||'Routine', clinicalNotes||null]);
    // Notify lab technicians
    const labTechs = await query("SELECT id FROM staff WHERE role='lab_tech' AND is_active=TRUE");
    const patLab = await query('SELECT first_name,last_name FROM patients WHERE id=$1',[patientId]).catch(()=>({rows:[]}));
    const plnm = patLab.rows[0] ? `${patLab.rows[0].first_name} ${patLab.rows[0].last_name}` : 'a patient';
    const urgLabel = urgency === 'STAT' ? '🚨 STAT' : urgency === 'Urgent' ? '⚠ Urgent' : 'Routine';
    for (const tech of labTechs.rows) {
      await query(`INSERT INTO notifications(recipient_id,recipient_type,title,message,type,action_url) VALUES($1,'staff',$2,$3,'lab','lab-dashboard.html')`,
        [tech.id, `🔬 New Lab Request [${urgLabel}]`, `${st.first_name} ${st.last_name} has requested ${tests.length} test(s) for ${plnm}.`]
      ).catch(()=>{});
    }
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get lab requests (queue for lab tech)
router.get('/lab/requests', authMiddleware, async (req,res) => {
  try {
    const { status='Pending', patientId } = req.query;
    const conds=[`lr.status=$1`]; const params=[status];
    if (patientId) { params.push(patientId); conds.push(`lr.patient_id=$${params.length}`); }
    const r = await query(`SELECT lr.*, p.first_name||' '||p.last_name as patient_name, p.patient_id as pid
      FROM lab_requests lr JOIN patients p ON p.id=lr.patient_id
      WHERE ${conds.join(' AND ')} ORDER BY lr.urgency='Urgent' DESC, lr.created_at`,params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Enter lab results
router.put('/lab/requests/:id/results', authMiddleware, rbacMiddleware('lab_tech','admin'), async (req,res) => {
  try {
    const { results, labNotes } = req.body;
    if (!results?.length) return res.status(400).json({ error: 'Results required' });
    const s = await query('SELECT first_name,last_name FROM staff WHERE id=$1',[req.user.id]);
    const st = s.rows[0];
    const r = await query(`UPDATE lab_requests SET status='Completed', results=$1::jsonb, lab_notes=$2,
      reported_by=$3, reporter_name=$4, reported_at=NOW() WHERE id=$5 RETURNING *`,
      [JSON.stringify(results), labNotes||null, req.user.id, `${st.first_name} ${st.last_name}`, req.params.id]);
    // Notify requesting doctor immediately (DB trigger also fires but this is direct)
    if (r.rows[0]?.requested_by) {
      const patR = await query('SELECT first_name,last_name FROM patients WHERE id=$1',[r.rows[0].patient_id]).catch(()=>({rows:[]}));
      const pnm = patR.rows[0] ? `${patR.rows[0].first_name} ${patR.rows[0].last_name}` : 'your patient';
      await query(`INSERT INTO notifications(recipient_id,recipient_type,title,message,type,action_url) VALUES($1,'staff','🔬 Lab Results Ready',$2,'lab','doctor-dashboard.html')`,
        [r.rows[0].requested_by, `Lab results are ready for ${pnm}. ${results.length} test(s) reported by ${st.first_name} ${st.last_name}.`]
      ).catch(()=>{});
    }
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get lab results for a patient
router.get('/lab/results/:patientId', authMiddleware, async (req,res) => {
  try {
    const r = await query(`SELECT * FROM lab_requests WHERE patient_id=$1 AND status='Completed' ORDER BY reported_at DESC`,[req.params.patientId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BILLING & FINANCE ──────────────────────────────────────────
// Create invoice
router.post('/billing/invoices', authMiddleware, async (req,res) => {
  try {
    const { patientId, journeyId, items, insuranceProvider, insuranceNo } = req.body;
    if (!patientId||!items?.length) return res.status(400).json({ error: 'Patient and items required' });
    const total = items.reduce((sum,i) => sum + (parseFloat(i.unitPrice||0)*parseInt(i.quantity||1)), 0);
    const invNo = `INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const r = await query(`INSERT INTO invoices(invoice_no,patient_id,journey_id,items,total_amount,insurance_provider,insurance_no,created_by)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8) RETURNING *`,
      [invNo,patientId,journeyId||null,JSON.stringify(items),total,insuranceProvider||null,insuranceNo||null,req.user.id]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get invoices
router.get('/billing/invoices', authMiddleware, async (req,res) => {
  try {
    const { status, patientId, page=1, limit=50 } = req.query;
    const conds=[]; const params=[]; const off=(page-1)*limit;
    if (status) { params.push(status); conds.push(`i.status=$${params.length}`); }
    if (patientId) { params.push(patientId); conds.push(`i.patient_id=$${params.length}`); }
    const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
    params.push(limit,off);
    const r = await query(`SELECT i.*, p.first_name||' '||p.last_name as patient_name, p.patient_id as pid
      FROM invoices i JOIN patients p ON p.id=i.patient_id ${where} ORDER BY i.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Record payment
router.post('/billing/payments', authMiddleware, rbacMiddleware('accountant','admin','receptionist'), async (req,res) => {
  try {
    const { invoiceId, amount, paymentMethod, reference } = req.body;
    if (!invoiceId||!amount) return res.status(400).json({ error: 'Invoice and amount required' });
    const inv = await query('SELECT * FROM invoices WHERE id=$1',[invoiceId]);
    if (!inv.rows.length) return res.status(404).json({ error: 'Invoice not found' });
    const r = await query(`INSERT INTO payments(invoice_id,amount,payment_method,reference,received_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [invoiceId,amount,paymentMethod||'Cash',reference||null,req.user.id]);
    // Update invoice balance
    const totalPaid = parseFloat(inv.rows[0].amount_paid||0) + parseFloat(amount);
    const newBalance = Math.max(0, parseFloat(inv.rows[0].total_amount) - totalPaid);
    const newStatus = newBalance <= 0 ? 'Paid' : 'Partial';
    await query('UPDATE invoices SET amount_paid=$1, balance=$2, status=$3 WHERE id=$4',
      [totalPaid, newBalance, newStatus, invoiceId]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Finance dashboard stats
router.get('/billing/stats', authMiddleware, rbacMiddleware('accountant','admin'), async (req,res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const [todayRev, outstanding, totalInv, byMethod] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE DATE(created_at)=$1`,[today]),
      query(`SELECT COALESCE(SUM(balance),0) as total FROM invoices WHERE status IN ('Unpaid','Partial')`),
      query(`SELECT status, COUNT(*), COALESCE(SUM(total_amount),0) as amount FROM invoices GROUP BY status`),
      query(`SELECT payment_method, COALESCE(SUM(amount),0) as total FROM payments WHERE DATE(created_at)=$1 GROUP BY payment_method`,[today]),
    ]);
    res.json({
      todayRevenue: parseFloat(todayRev.rows[0].total),
      outstandingBalance: parseFloat(outstanding.rows[0].total),
      invoicesByStatus: totalInv.rows,
      todayByMethod: byMethod.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SHIFTS ─────────────────────────────────────────────────────
// Get shifts for a week
router.get('/shifts', authMiddleware, async (req,res) => {
  try {
    const { weekStart, staffId, dept } = req.query;
    const wk = weekStart || new Date().toISOString().slice(0,10);
    const conds=[`week_start_date=$1`]; const params=[wk];
    if (staffId) { params.push(staffId); conds.push(`staff_id=$${params.length}`); }
    else if (!req.user.role==='admin') { params.push(req.user.id); conds.push(`staff_id=$${params.length}`); }
    if (dept) { params.push(dept); conds.push(`dept_code=$${params.length}`); }
    const r = await query(`SELECT sh.*, s.first_name||' '||s.last_name as staff_name FROM shifts sh
      JOIN staff s ON s.id=sh.staff_id WHERE ${conds.join(' AND ')} ORDER BY sh.shift_date, sh.shift_type`,params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create/assign shift (admin)
router.post('/shifts', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { staffId, shiftType, shiftDate, weekStart, startTime, endTime, deptCode, notes } = req.body;
    if (!staffId||!shiftType||!shiftDate) return res.status(400).json({ error: 'Staff, type and date required' });
    const r = await query(`INSERT INTO shifts(staff_id,shift_type,shift_date,week_start_date,start_time,end_time,dept_code,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(staff_id,shift_date,shift_type) DO UPDATE
      SET start_time=$5,end_time=$6,dept_code=$7,notes=$8 RETURNING *`,
      [staffId,shiftType,shiftDate,weekStart||shiftDate,startTime||null,endTime||null,deptCode||null,notes||null]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── NOTIFICATIONS ──────────────────────────────────────────────
router.use('/notifications', notificationsRouter);

// Get my notifications
router.get('/notifications', authMiddleware, async (req,res) => {
  try {
    const r = await query(`SELECT * FROM notifications WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 50`,[req.user.id]);
    const unread = await query(`SELECT COUNT(*) FROM notifications WHERE recipient_id=$1 AND is_read=FALSE`,[req.user.id]);
    res.json({ notifications: r.rows, unreadCount: parseInt(unread.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark notifications read
router.put('/notifications/read-all', authMiddleware, async (req,res) => {
  try {
    await query('UPDATE notifications SET is_read=TRUE, read_at=NOW() WHERE recipient_id=$1',[req.user.id]);
    res.json({ message: 'All marked read' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EMR — MEDICAL RECORDS ──────────────────────────────────────
// Get patient full medical history
router.get('/emr/:patientId', authMiddleware, async (req,res) => {
  try {
    const [patient, journeys, labResults, prescriptions] = await Promise.all([
      query('SELECT * FROM patients WHERE id=$1',[req.params.patientId]),
      query(`SELECT pj.*, (SELECT COUNT(*) FROM journey_steps WHERE journey_id=pj.id) as step_count
        FROM patient_journey pj WHERE pj.patient_id=$1 ORDER BY pj.visit_date DESC LIMIT 20`,[req.params.patientId]),
      query(`SELECT * FROM lab_requests WHERE patient_id=$1 AND status='Completed' ORDER BY reported_at DESC LIMIT 20`,[req.params.patientId]),
      query(`SELECT * FROM prescriptions WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 20`,[req.params.patientId]),
    ]);
    if (!patient.rows.length) return res.status(404).json({ error: 'Patient not found' });
    res.json({
      patient: patient.rows[0],
      visitHistory: journeys.rows,
      labResults: labResults.rows,
      prescriptions: prescriptions.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATIENT PORTAL ─────────────────────────────────────────────
// Patient: my full records
router.get('/patient/my-records', authMiddleware, async (req,res) => {
  try {
    console.log('[MY_RECORDS] user:', req.user);
    if (req.user.role !== 'patient') return res.status(403).json({ error: 'Patients only' });
    const patId = await query('SELECT id FROM patients WHERE id=$1',[req.user.id]);
    console.log('[MY_RECORDS] patient found:', patId.rows.length);
    if (!patId.rows.length) return res.status(404).json({ error: 'Not found' });
    const [journeys, labs, prescriptions, appointments] = await Promise.all([
      query(`SELECT pj.*, (SELECT json_agg(js ORDER BY js.step_no) FROM journey_steps js WHERE js.journey_id=pj.id AND js.submitted=TRUE) as steps
        FROM patient_journey pj WHERE pj.patient_id=$1 ORDER BY pj.visit_date DESC LIMIT 10`,[req.user.id]),
      query(`SELECT * FROM lab_requests WHERE patient_id=$1 AND status='Completed' ORDER BY reported_at DESC LIMIT 15`,[req.user.id]),
      query(`SELECT * FROM prescriptions WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 15`,[req.user.id]),
      query(`SELECT a.*, s.first_name||' '||s.last_name as doctor_name, d.name as dept_name
        FROM appointments a LEFT JOIN staff s ON s.id=a.doctor_id LEFT JOIN departments d ON d.code=a.dept_code
        WHERE a.patient_id=$1 ORDER BY a.appointment_date DESC LIMIT 10`,[req.user.id]),
    ]);
    console.log('[MY_RECORDS] journeys:', journeys.rows.length, 'labs:', labs.rows.length, 'prescriptions:', prescriptions.rows.length, 'appointments:', appointments.rows.length);
    res.json({ visits: journeys.rows, labResults: labs.rows, prescriptions: prescriptions.rows, appointments: appointments.rows });
  } catch(e) { 
    console.error('[MY_RECORDS] Error:', e);
    res.status(500).json({ error: e.message }); 
  }
});

// ── ATTENDANCE EXPORT ──────────────────────────────────────────
router.get('/attendance/export', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { dateFrom, dateTo, dept } = req.query;
    const from = dateFrom || new Date().toISOString().slice(0,10);
    const to = dateTo || from;
    const conds=['a.work_date>=$1 AND a.work_date<=$2']; const params=[from,to];
    if (dept) { params.push(dept); conds.push(`a.dept_code=$${params.length}`); }
    const r = await query(`SELECT a.*, s.email FROM attendance_log a JOIN staff s ON s.id=a.staff_id
      WHERE ${conds.join(' AND ')} ORDER BY a.work_date DESC, a.dept_code, a.staff_name`, params);
    // Return CSV
    const header = 'Date,Staff ID,Name,Department,Role,Clock In,Clock Out,Duration (min),Status,Late By (min),Report Submitted\n';
    const rows = r.rows.map(x => [
      x.work_date, x.staff_code, x.staff_name, x.dept_code, x.role,
      x.clock_in_time ? new Date(x.clock_in_time).toLocaleTimeString('en-KE') : '',
      x.clock_out_time ? new Date(x.clock_out_time).toLocaleTimeString('en-KE') : '',
      x.duration_minutes||'', x.status, x.late_by_minutes||0,
      x.daily_report_submitted ? 'Yes' : 'No'
    ].join(',')).join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="attendance-${from}-to-${to}.csv"`);
    res.send(header+rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN PROFILE (private — only visible to the owner) ────────
router.get('/admin/profile', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const staff = await query('SELECT * FROM staff WHERE id=$1',[req.user.id]);
    const profile = await query('SELECT * FROM admin_profiles WHERE staff_id=$1',[req.user.id]);
    res.json({ staff: staff.rows[0], profile: profile.rows[0] || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/profile', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { bio, responsibilities, officeLocation, directPhone, signatureText, profilePhotoB64 } = req.body;
    // Update staff name/phone fields
    if (req.body.firstName || req.body.lastName || req.body.phone) {
      await query(`UPDATE staff SET
        first_name=COALESCE($1,first_name),
        last_name=COALESCE($2,last_name),
        phone=COALESCE($3,phone)
        WHERE id=$4`,
        [req.body.firstName||null, req.body.lastName||null, req.body.phone||null, req.user.id]);
    }
    // Upsert admin_profiles
    await query(`INSERT INTO admin_profiles(staff_id,bio,responsibilities,office_location,direct_phone,signature_text,profile_photo_b64,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT(staff_id) DO UPDATE SET
        bio=EXCLUDED.bio, responsibilities=EXCLUDED.responsibilities,
        office_location=EXCLUDED.office_location, direct_phone=EXCLUDED.direct_phone,
        signature_text=EXCLUDED.signature_text,
        profile_photo_b64=COALESCE(EXCLUDED.profile_photo_b64, admin_profiles.profile_photo_b64),
        updated_at=NOW()`,
      [req.user.id, bio||null, responsibilities||null, officeLocation||null,
       directPhone||null, signatureText||null, profilePhotoB64||null]);
    res.json({ message: 'Profile updated.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/change-password', authMiddleware, rbacMiddleware('admin'), async (req,res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword||!newPassword) return res.status(400).json({error:'Both fields required'});
    if (newPassword.length < 8) return res.status(400).json({error:'Min 8 characters'});
<<<<<<< HEAD
    const bcrypt = (await import('bcrypt')).default;
=======
    const bcrypt = (await import('bcryptjs')).default;
>>>>>>> 82282e34a8288fccb7ed8f89834e7fa77ec9eba8
    const st = await query('SELECT password_hash FROM staff WHERE id=$1',[req.user.id]);
    const valid = await bcrypt.compare(currentPassword, st.rows[0].password_hash);
    if (!valid) return res.status(401).json({error:'Current password is incorrect'});
    const hash = await bcrypt.hash(newPassword,10);
    await query('UPDATE staff SET password_hash=$1,must_change_password=false,password_changed_at=NOW() WHERE id=$2',[hash,req.user.id]);
    res.json({message:'Password changed successfully.'});
  } catch(e) { res.status(500).json({error:e.message}); }
});



// ── CHATBOT EMAIL ADMIN ───────────────────────────────────────
router.post('/chat/email-admin', authMiddleware, async (req, res) => {
  try {
    const { issue, from, role, staffId } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
    const { sendIntrusionAlert } = await import('../services/emailService.js');

    // Use nodemailer directly for a simple admin notification
    import('../services/emailService.js').then(async (emailSvc) => {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: 587, secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: adminEmail,
        subject: `[AIC HMS Chatbot] Issue reported by ${from} (${staffId})`,
        html: `<div style="font-family:Arial,sans-serif;padding:20px">
          <h3 style="color:#C8860A">HMS Chatbot — User Issue Report</h3>
          <p><strong>From:</strong> ${from}</p>
          <p><strong>Role:</strong> ${role}</p>
          <p><strong>ID:</strong> ${staffId}</p>
          <p><strong>Issue:</strong></p>
          <div style="background:#f5f5f5;padding:12px;border-radius:8px;margin:8px 0">${issue}</div>
          <p style="color:#888;font-size:12px">Sent from AIC Kapsowar HMS Chatbot</p>
        </div>`
      });
    }).catch(e => console.error('Chat email error:', e.message));

    res.json({ success: true });
  } catch(e) {
    console.error('Chat email route error:', e.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ── CHATBOT PROXY ─────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  res.status(501).json({ error: 'Chat proxy not configured' });
});

export default router;
