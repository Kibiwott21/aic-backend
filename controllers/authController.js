import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { generateToken, generatePatientToken } from '../middleware/auth.js';
import {
  sendStaffVerification, sendPatientVerification,
  sendLoginOTP, sendPasswordReset
} from '../services/emailService.js';

const FRONTEND = (process.env.FRONTEND_URL || '${process.env.next_public_api_url}').replace(/\/frontend\/pages\/?$/, '').replace(/:5500/, ':3000').replace(/:5173/, ':3000');

// ════════════════════════════════════════════════════════════
// BRUTE FORCE PROTECTION — In-memory + Database
// Tracks: { ip: { attempts: N, firstAttempt: Date, blocked: bool } }
// ════════════════════════════════════════════════════════════
const bruteForceMap = new Map();
const MAX_ATTEMPTS   = 5;      // Block after 5 failures
const WINDOW_MS      = 15 * 60 * 1000; // 15 minute window
const BLOCK_MS       = 30 * 60 * 1000; // Block for 30 minutes

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

async function checkBruteForce(ip, staffId) {
  const now = Date.now();
  const record = bruteForceMap.get(ip) || { attempts: 0, firstAttempt: now, blocked: false, blockedAt: null };

  // If currently blocked — check if block window expired
  if (record.blocked) {
    if (now - record.blockedAt < BLOCK_MS) {
      const remaining = Math.ceil((BLOCK_MS - (now - record.blockedAt)) / 60000);
      return { blocked: true, remaining, attempts: record.attempts };
    } else {
      // Block expired — reset
      bruteForceMap.delete(ip);
      return { blocked: false };
    }
  }

  // Reset window if expired
  if (now - record.firstAttempt > WINDOW_MS) {
    bruteForceMap.delete(ip);
    return { blocked: false };
  }

  return { blocked: false, attempts: record.attempts };
}

async function recordFailedAttempt(ip, staffId, req) {
  const now = Date.now();
  const record = bruteForceMap.get(ip) || { attempts: 0, firstAttempt: now, blocked: false };

  record.attempts += 1;
  bruteForceMap.set(ip, record);

  // Log to audit_logs
  await query(
    `INSERT INTO audit_logs (actor_id, action, resource, method, status_code, ip_address, severity, timestamp)
     VALUES ($1, $2, $3, 'POST', 401, $4, $5, NOW())`,
    [staffId || 'unknown',
     `FAILED_LOGIN_ATTEMPT (${record.attempts}/${MAX_ATTEMPTS})`,
     `staff:${staffId}`, ip,
     record.attempts >= MAX_ATTEMPTS ? 'critical' : record.attempts >= 3 ? 'warning' : 'info']
  ).catch(() => {});

  // BLOCK if threshold reached
  if (record.attempts >= MAX_ATTEMPTS) {
    record.blocked = true;
    record.blockedAt = now;
    bruteForceMap.set(ip, record);

    // Create security alert in database — shows on dashboard
    await createBruteForceAlert(ip, staffId, record.attempts, req);
    return { blocked: true, remaining: 30, attempts: record.attempts };
  }

  return { blocked: false, attempts: record.attempts, remaining_attempts: MAX_ATTEMPTS - record.attempts };
}

async function createBruteForceAlert(ip, staffId, attempts, req) {
  try {
    const userAgent = (req.headers['user-agent'] || '').slice(0, 200);
    await query(
      `INSERT INTO security_alerts
         (severity, category, title, description, source, source_ip, status)
       VALUES ('critical', 'Brute Force Attack', $1, $2, 'Auth Middleware', $3, 'active')`,
      [
        `🚨 Brute Force Detected — ${attempts} failed login attempts`,
        `IP ${ip} made ${attempts} consecutive failed login attempts for account "${staffId}" within 15 minutes. Account access has been temporarily blocked for 30 minutes. User-Agent: ${userAgent}`,
        ip
      ]
    );
    console.warn(`[SECURITY] Brute force blocked: IP ${ip} → Staff ${staffId} (${attempts} attempts)`);
  } catch (e) {
    console.error('Failed to create security alert:', e.message);
  }
}

function clearBruteForce(ip) {
  bruteForceMap.delete(ip);
}

function genOTP()   { return String(Math.floor(100000 + Math.random() * 900000)); }
function genToken() { return uuidv4().replace(/-/g, '') + Date.now().toString(36); }
function genStaffId(deptCode) { return deptCode.toUpperCase() + String(Math.floor(1000 + Math.random() * 9000)); }
function genPatientId()       { return 'PAT' + String(Math.floor(10000 + Math.random() * 90000)); }

// ── STAFF LOGIN (with brute force protection) ─────────────────
export const staffLogin = async (req, res) => {
  try {
    const ip = getClientIP(req);
    const { staffId, password } = req.body;

    if (!staffId || !password) return res.status(400).json({ error: 'Staff ID and password required' });

    // ① Check if IP is currently blocked
    const bfCheck = await checkBruteForce(ip, staffId);
    if (bfCheck.blocked) {
      return res.status(429).json({
        error: `Too many failed attempts. Your IP is blocked for ${bfCheck.remaining} more minutes.`,
        code: 'IP_BLOCKED',
        blocked_until: new Date(Date.now() + bfCheck.remaining * 60000).toISOString()
      });
    }

    // ② Find staff
    const result = await query(
      'SELECT * FROM staff WHERE staff_id = $1 AND is_active = true',
      [staffId.toUpperCase().trim()]
    );

    if (!result.rows.length) {
      const bf = await recordFailedAttempt(ip, staffId, req);
      return res.status(401).json({
        error: 'Invalid Staff ID or password',
        ...(bf.blocked ? { code: 'IP_BLOCKED', message: 'IP blocked for 30 minutes' } : { remaining_attempts: bf.remaining_attempts })
      });
    }

    const staff = result.rows[0];

    // ③ Verify password
    const valid = await bcrypt.compare(password, staff.password_hash);
    if (!valid) {
      const bf = await recordFailedAttempt(ip, staff.staff_id, req);
      return res.status(401).json({
        error: 'Invalid Staff ID or password',
        ...(bf.blocked
          ? { code: 'IP_BLOCKED', message: '🚨 Your IP has been blocked for 30 minutes due to too many failed attempts. A security alert has been raised.' }
          : { remaining_attempts: bf.remaining_attempts, warning: bf.remaining_attempts <= 2 ? `⚠ ${bf.remaining_attempts} attempt(s) left before IP block` : undefined })
      });
    }

    // ④ Successful auth — clear brute force record
    clearBruteForce(ip);

    // ── EMAIL VERIFICATION CHECK ────────────────────────────
    if (!staff.email_verified) {
      // Resend verification email automatically
      const token = genToken();
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await query(
        `UPDATE staff SET email_verification_token=$1, email_token_expires=$2 WHERE id=$3`,
        [token, tokenExpires, staff.id]
      );
      const verifyUrl = `${FRONTEND}/verify-email.html?token=${token}&type=staff`;
      try {
        await sendStaffVerification(
          staff.email,
          `${staff.first_name} ${staff.last_name}`,
          staff.staff_id,
          verifyUrl
        );
      } catch (emailErr) {
        console.warn('Re-send verification email failed:', emailErr.message);
      }

      return res.status(403).json({
        error: 'Your email address has not been verified yet.',
        code: 'EMAIL_NOT_VERIFIED',
        email: staff.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
        message: 'A new verification link has been sent to your email. Please check your inbox (and spam folder) and click the link to activate your account.',
        action: 'CHECK_EMAIL'
      });
    }

    // ⑤ Send OTP
    const otp = genOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await query(
      `INSERT INTO email_tokens (entity_type, entity_id, email, token, token_type, expires_at)
       VALUES ('staff', $1, $2, $3, 'login_otp', $4)`,
      [staff.id, staff.email, otp, expires]
    );

    try { await sendLoginOTP(staff.email, `${staff.first_name} ${staff.last_name}`, otp, true); }
    catch (e) { console.warn('OTP email failed:', e.message); }

    // ⑥ Record login time for attendance
    await recordAttendance(staff, ip, req);

    await query('UPDATE staff SET last_login=NOW() WHERE id=$1', [staff.id]);

    res.json({
      message: 'OTP sent to registered email',
      requireOTP: true,
      staffId: staff.staff_id,
      email: staff.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
      mustChangePassword: staff.must_change_password,
    });
  } catch (err) {
    console.error('Staff login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── ATTENDANCE AUTO-RECORD ────────────────────────────────────
async function recordAttendance(staff, ip, req) {
  try {
    await query(
      `INSERT INTO attendance_log
         (staff_id, staff_code, staff_name, dept_code, role, work_date, clock_in_time, clock_in_ip)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, NOW(), $6)
       ON CONFLICT (staff_id, work_date) DO UPDATE
         SET clock_in_time = LEAST(attendance_log.clock_in_time, NOW()),
             clock_in_ip = EXCLUDED.clock_in_ip`,
      [staff.id, staff.staff_id,
       `${staff.first_name} ${staff.last_name}`,
       staff.dept_code, staff.role, ip]
    );
  } catch (e) {
    console.warn('Attendance record failed:', e.message);
  }
}

// ── VERIFY STAFF OTP ─────────────────────────────────────────
export const verifyStaffOTP = async (req, res) => {
  try {
    const { staffId, otp } = req.body;
    const tokenResult = await query(
      `SELECT et.*, s.* FROM email_tokens et
       JOIN staff s ON s.id = et.entity_id
       WHERE s.staff_id = $1 AND et.token = $2 AND et.token_type = 'login_otp'
       AND et.entity_type = 'staff' AND et.used = false AND et.expires_at > NOW()
       ORDER BY et.created_at DESC LIMIT 1`,
      [staffId?.toUpperCase(), otp]
    );
    if (!tokenResult.rows.length)
      return res.status(401).json({ error: 'Invalid or expired OTP code' });

    const row = tokenResult.rows[0];
    await query('UPDATE email_tokens SET used=true, used_at=NOW() WHERE id=$1', [row.id]);
    const staff = await query('SELECT * FROM staff WHERE staff_id=$1', [staffId.toUpperCase()]);
    const s = staff.rows[0];
    const token = generateToken(s);
    res.json({ token, mustChangePassword: s.must_change_password,
      user: { id: s.id, staffId: s.staff_id, name: `${s.first_name} ${s.last_name}`,
              email: s.email, role: s.role, dept: s.dept_code } });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

// ── PATIENT LOGIN (with brute force) ─────────────────────────
export const patientLogin = async (req, res) => {
  try {
    const ip = getClientIP(req);
    const { patientId, password } = req.body;
    if (!patientId) return res.status(400).json({ error: 'Patient ID required' });

    const bfCheck = await checkBruteForce(ip, patientId);
    if (bfCheck.blocked) return res.status(429).json({ error: `IP blocked for ${bfCheck.remaining} minutes`, code: 'IP_BLOCKED' });

    const result = await query('SELECT * FROM patients WHERE patient_id=$1 AND is_active=true', [patientId.toUpperCase().trim()]);
    if (!result.rows.length) {
      await recordFailedAttempt(ip, patientId, req);
      return res.status(404).json({ error: 'Patient ID not found' });
    }

    const patient = result.rows[0];

    // ── Password login (if password provided and patient has one) ──
    if (password && patient.portal_password_hash) {
      const valid = await bcrypt.compare(password, patient.portal_password_hash);
      if (!valid) {
        const bf = await recordFailedAttempt(ip, patientId, req);
        return res.status(401).json({
          error: 'Invalid Patient ID or password',
          ...(bf.remaining_attempts ? { remaining_attempts: bf.remaining_attempts } : {})
        });
      }
      // Password correct — send OTP for MFA
      if (!patient.email) {
        // No email — issue token directly (no MFA)
        const token = jwt.sign({ id: patient.id, patientId: patient.patient_id, role: 'patient' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        clearBruteForce(ip);
        return res.json({
          token,
          mustChangePassword: patient.must_change_password || false,
          patient: { id: patient.id, patientId: patient.patient_id, name: `${patient.first_name} ${patient.last_name}`, role: 'patient' }
        });
      }
      clearBruteForce(ip);
      const otp = genOTP();
      const expires = new Date(Date.now() + 10 * 60 * 1000);
      await query(`INSERT INTO email_tokens (entity_type,entity_id,email,token,token_type,expires_at) VALUES ('patient',$1,$2,$3,'login_otp',$4)`,
        [patient.id, patient.email, otp, expires]);
      try { await sendLoginOTP(patient.email, `${patient.first_name} ${patient.last_name}`, otp, false); } catch(e) {}
      return res.json({
        requireOTP: true,
        mustChangePassword: patient.must_change_password || false,
        email: patient.email.replace(/(.{2}).*(@.*)/, '$1***$2')
      });
    }

    // ── OTP-only login (no password provided) ──
    if (!patient.email) return res.status(400).json({ error: 'No email on file. Visit the hospital to update your records.' });
    clearBruteForce(ip);
    const otp = genOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await query(`INSERT INTO email_tokens (entity_type,entity_id,email,token,token_type,expires_at) VALUES ('patient',$1,$2,$3,'login_otp',$4)`,
      [patient.id, patient.email, otp, expires]);
    try { await sendLoginOTP(patient.email, `${patient.first_name} ${patient.last_name}`, otp, false); } catch(e) {}
    res.json({ message: 'OTP sent', email: patient.email.replace(/(.{2}).*(@.*)/, '$1***$2') });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

export const verifyPatientOTP = async (req, res) => {
  try {
    const { patientId, otp } = req.body;
    console.log('[VERIFY_OTP] Received - patientId:', patientId, 'OTP:', otp);
    if (!patientId || !otp) return res.status(400).json({ error: 'Patient ID and OTP required' });
    
    const patientCheck = await query('SELECT * FROM patients WHERE patient_id=$1', [patientId.toUpperCase()]);
    console.log('[VERIFY_OTP] Patient found:', patientCheck.rows.length > 0);
    if (!patientCheck.rows.length) return res.status(401).json({ error: 'Invalid Patient ID' });
    
    const result = await query(
      `SELECT et.* FROM email_tokens et
       WHERE et.entity_id=$1 AND et.token=$2 AND et.token_type='login_otp' AND et.entity_type='patient' AND et.used=false AND et.expires_at>NOW()
       ORDER BY et.created_at DESC LIMIT 1`, 
      [patientCheck.rows[0].id, String(otp)]);
    console.log('[VERIFY_OTP] OTP record found:', result.rows.length);
    
    if (!result.rows.length) {
      const usedCheck = await query(
        `SELECT * FROM email_tokens WHERE entity_id=$1 AND token=$2 AND entity_type='patient' AND token_type='login_otp'`,
        [patientCheck.rows[0].id, String(otp)]);
      if (usedCheck.rows.length) {
        return res.status(401).json({ error: 'OTP already used. Please request a new one.' });
      }
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
    
    const row = result.rows[0];
    await query('UPDATE email_tokens SET used=true, used_at=NOW() WHERE id=$1', [row.id]);
    
    const patient = patientCheck.rows[0];
    const token = generatePatientToken(patient);
    res.json({ token, patient: { id: patient.id, patientId: patient.patient_id, name: `${patient.first_name} ${patient.last_name}`, email: patient.email, role: 'patient' } });
  } catch (err) { 
    console.error('[VERIFY_PATIENT_OTP_ERROR]', err);
    res.status(500).json({ error: 'Server error' }); 
  }
};

export const registerStaff = async (req, res) => {
  try {
    const { firstName, middleName, lastName, dob, gender, nationality, nationalId,
      email, phone, altPhone, county, town, address,
      kinName, kinRelation, kinPhone,
      deptCode, jobTitle, role, qualification, licenceNo, startDate, password } = req.body;
    if (!firstName || !lastName || !email || !password || !deptCode)
      return res.status(400).json({ error: 'First name, last name, email, password and department are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const exists = await query('SELECT id FROM staff WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });
    let staffId, attempts = 0;
    do { staffId = genStaffId(deptCode); const c = await query('SELECT id FROM staff WHERE staff_id=$1',[staffId]); if(!c.rows.length)break; attempts++; } while(attempts<100);
    const hash = await bcrypt.hash(password, 10);
    const token = genToken(); const tokenExpires = new Date(Date.now() + 24*60*60*1000);
    await query(`INSERT INTO staff (staff_id,first_name,middle_name,last_name,date_of_birth,gender,nationality,national_id,email,phone,alt_phone,county,town,address,kin_name,kin_relation,kin_phone,dept_code,job_title,role,qualification,licence_no,start_date,password_hash,email_verification_token,email_token_expires,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,false)`,
      [staffId,firstName,middleName||null,lastName,dob||null,gender||null,nationality||'Kenyan',nationalId||null,email.toLowerCase(),phone||null,altPhone||null,county||null,town||null,address||null,kinName||null,kinRelation||null,kinPhone||null,deptCode.toUpperCase(),jobTitle||null,role||'staff',qualification||null,licenceNo||null,startDate||null,hash,token,tokenExpires]);
    const verifyUrl = `${FRONTEND}/verify-email.html?token=${token}&type=staff`;
    try { await sendStaffVerification(email, `${firstName} ${lastName}`, staffId, verifyUrl); } catch(e){}
    res.status(201).json({ message: 'Registration successful! Check your email to verify.', staffId, emailSent: true });
  } catch (err) { 
    console.error('[REGISTER-STAFF ERROR]', err.message, err.code);
    if(err.code==='23505') return res.status(409).json({error:'Email already exists'});
    if(err.code==='23503') return res.status(400).json({error:'Invalid department code'});
    res.status(500).json({error:'Registration failed - '+err.message}); 
  }
};

export const registerPatient = async (req, res) => {
  try {
    const { firstName, middleName, lastName, dob, gender, nationality, nationalId, email, phone, altPhone, county, town, address, kinName, kinRelation, kinPhone, bloodGroup, allergies, chronicConditions, insuranceProvider, insuranceNo, password } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name required' });
    let patientId, attempts = 0;
    do { patientId = genPatientId(); const c = await query('SELECT id FROM patients WHERE patient_id=$1',[patientId]); if(!c.rows.length)break; attempts++; } while(attempts<100);
    // Auto-generate temp password if none provided (receptionist-registered patients)
    const tempPassword = password || (firstName.slice(0,2).toUpperCase() + patientId.slice(-4) + '@Aic');
    const hash = await bcrypt.hash(tempPassword, 10);
    const token = genToken(); const tokenExpires = new Date(Date.now() + 24*60*60*1000);
    await query(`INSERT INTO patients (patient_id,first_name,middle_name,last_name,date_of_birth,gender,nationality,national_id,email,phone,alt_phone,county,town,address,kin_name,kin_relation,kin_phone,blood_group,allergies,chronic_conditions,insurance_provider,insurance_no,portal_password_hash,email_verification_token,email_token_expires) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [patientId,firstName,middleName||null,lastName,dob||null,gender||null,nationality||'Kenyan',nationalId||null,email?.toLowerCase()||null,phone||null,altPhone||null,county||null,town||null,address||null,kinName||null,kinRelation||null,kinPhone||null,bloodGroup||null,allergies||null,chronicConditions||null,insuranceProvider||null,insuranceNo||null,hash,token,tokenExpires]);
    if (email) { 
      const verifyUrl=`${FRONTEND}/verify-email.html?token=${token}&type=patient`; 
      try{ await sendPatientVerification(email,`${firstName} ${lastName}`,patientId,verifyUrl,tempPassword,!password); }catch(e){} 
    }
    res.status(201).json({ message: 'Patient registered!', patientId, emailSent: !!email, tempPassword: !password ? tempPassword : undefined });
  } catch (err) { 
    console.error('[REGISTER-PATIENT ERROR]', err.message, err.code);
    if(err.code==='23505') return res.status(409).json({error:'Email already registered'}); 
    res.status(500).json({error:'Registration failed - '+err.message}); 
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token, type } = req.query;
    if (!token || !type) return res.status(400).json({ error: 'Token and type required' });
    const table = type === 'staff' ? 'staff' : 'patients';
    const inline = await query(`SELECT * FROM ${table} WHERE email_verification_token=$1 AND email_token_expires>NOW()`, [token]);
    if (!inline.rows.length) return res.status(400).json({ error: 'Invalid or expired verification link' });
    await query(`UPDATE ${table} SET email_verified=true, email_verification_token=null, email_token_expires=null WHERE id=$1`, [inline.rows[0].id]);
    res.json({ message: 'Email verified successfully! You can now log in.', type });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

export const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const staffR = await query('SELECT * FROM staff WHERE email=$1',[email.toLowerCase()]);
    const patR = await query('SELECT * FROM patients WHERE email=$1',[email.toLowerCase()]);
    const entity = staffR.rows[0] || patR.rows[0];
    const type = staffR.rows[0] ? 'staff' : 'patient';
    if (!entity) return res.json({ message: 'If this email is registered, a reset link has been sent.' });
    const token = genToken(); const expires = new Date(Date.now() + 2*60*60*1000);
    await query(`INSERT INTO email_tokens (entity_type,entity_id,email,token,token_type,expires_at) VALUES ($1,$2,$3,$4,'reset_password',$5)`,[type,entity.id,email.toLowerCase(),token,expires]);
    const resetUrl = `${FRONTEND}/reset-password.html?token=${token}`;
    await sendPasswordReset(email, `${entity.first_name} ${entity.last_name}`, resetUrl);
    res.json({ message: 'If this email is registered, a reset link has been sent.' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
    const result = await query(`SELECT * FROM email_tokens WHERE token=$1 AND token_type='reset_password' AND used=false AND expires_at>NOW()`,[token]);
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
    const { entity_type, entity_id, id: tokenId } = result.rows[0];
    const table = entity_type==='staff'?'staff':'patients';
    const pwField = entity_type==='staff'?'password_hash':'portal_password_hash';
    const hash = await bcrypt.hash(newPassword, 10);
    await query(`UPDATE ${table} SET ${pwField}=$1, must_change_password=false, password_changed_at=NOW() WHERE id=$2`,[hash,entity_id]);
    await query('UPDATE email_tokens SET used=true, used_at=NOW() WHERE id=$1',[tokenId]);
    res.json({ message: 'Password reset successfully.' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
    const result = await query('SELECT password_hash FROM staff WHERE id=$1',[req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE staff SET password_hash=$1, must_change_password=false, password_changed_at=NOW() WHERE id=$2',[hash,req.user.id]);
    res.json({ message: 'Password updated.' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

export const getProfile = async (req, res) => {
  try {
    console.log('[GET_PROFILE] user:', req.user);
    if (req.user.role === 'patient') {
      const r = await query('SELECT id,patient_id,first_name,middle_name,last_name,email,phone,blood_group,insurance_provider,county,town,allergies FROM patients WHERE id=$1',[req.user.id]);
      console.log('[GET_PROFILE] Patient result:', r.rows.length);
      return res.json(r.rows[0]);
    }
    const r = await query('SELECT id,staff_id,first_name,middle_name,last_name,email,phone,role,dept_code,job_title,last_login FROM staff WHERE id=$1',[req.user.id]);
    res.json(r.rows[0]);
  } catch (err) { 
    console.error('[GET_PROFILE] Error:', err);
    res.status(500).json({ error: 'Server error' }); 
  }
};

// Export brute force status for admin dashboard
export const getBruteForceStatus = async (req, res) => {
  const entries = [];
  for (const [ip, record] of bruteForceMap.entries()) {
    entries.push({ ip, attempts: record.attempts, blocked: record.blocked,
      firstAttempt: new Date(record.firstAttempt).toISOString(),
      blockedUntil: record.blocked ? new Date(record.blockedAt + BLOCK_MS).toISOString() : null });
  }
  res.json({ active_blocks: entries.filter(e=>e.blocked).length, total_tracked_ips: entries.length, entries });
};