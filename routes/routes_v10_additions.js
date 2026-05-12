// ── AIC KAPSOWAR HMS v10 — ADDITIONAL ROUTES ─────────────────────────────────
// Add these to routes/index.js after existing routes
import nodemailer from 'nodemailer';

// ── EMAIL HELPER ──────────────────────────────────────────────────────────────
const sendEmail = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT||587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to, subject, html
    });
    return true;
  } catch(e) { console.error('Email failed:', e.message); return false; }
};

// ── CEO/ADMIN: REGISTER SENIOR MANAGEMENT ────────────────────────────────────
// CEO registers: hr_officer, finance_manager, medical_director, nursing_director
router.post('/ceo/register-senior-staff', authMiddleware, rbacMiddleware('ceo','admin'), async (req,res) => {
  try {
    const { firstName, middleName, lastName, email, phone, role, deptCode,
            jobTitle, nationalId, dateOfBirth, gender, county, town,
            qualification, licenceNo, kinName, kinRelation, kinPhone } = req.body;

    const allowedRoles = ['hr_officer','finance_manager','medical_director','nursing_director'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Only senior management roles can be registered via this endpoint' });
    }
    if (!firstName||!lastName||!email||!phone||!role) {
      return res.status(400).json({ error: 'First name, last name, email, phone and role are required' });
    }

    // Age check
    if (dateOfBirth) {
      const age = Math.floor((Date.now() - new Date(dateOfBirth)) / (1000*60*60*24*365.25));
      if (age < 18 || age > 70) return res.status(400).json({ error: 'Staff age must be between 18 and 70 years' });
    }

    // Dept mapping
    const deptMap = { hr_officer:'HR', finance_manager:'FIN', medical_director:'OUT', nursing_director:'INP' };
    const dept = deptCode || deptMap[role];

    // Generate staff ID
    const prefix = role==='hr_officer'?'HR':role==='finance_manager'?'FIN':role==='medical_director'?'MED':'NUR';
    const cnt = await query(`SELECT COUNT(*) FROM staff WHERE staff_id LIKE '${prefix}%'`);
    const staffId = `${prefix}${String(parseInt(cnt.rows[0].count)+1).padStart(4,'0')}`;

    // Temp password
    const tempPass = `${prefix}@AIC${new Date().getFullYear()}#`;
    const bcrypt = (await import('bcrypt')).default;
    const hash = await bcrypt.hash(tempPass, 10);

    // Verification token
    const crypto = (await import('crypto')).default;
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 48*60*60*1000);

    const r = await query(`
      INSERT INTO staff (staff_id,first_name,middle_name,last_name,email,phone,role,dept_code,
        job_title,national_id,date_of_birth,gender,county,town,qualification,licence_no,
        kin_name,kin_relation,kin_phone,password_hash,email_verification_token,
        email_token_expires,must_change_password,registered_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,TRUE,$23)
      RETURNING id,staff_id,first_name,last_name,email,role,dept_code`,
      [staffId,firstName,middleName||null,lastName,email,phone,role,dept,
       jobTitle||`${role.replace('_',' ')} – AIC Kapsowar`,
       nationalId||null,dateOfBirth||null,gender||null,county||null,town||null,
       qualification||null,licenceNo||null,kinName||null,kinRelation||null,kinPhone||null,
       hash,verifyToken,verifyExpires,req.user.id]
    );
    const newStaff = r.rows[0];

    // Create leave balance
    await query(`INSERT INTO leave_balances (staff_id) VALUES ($1) ON CONFLICT DO NOTHING`,[newStaff.id]);

    // Send welcome email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500/frontend/pages';
    const verifyUrl = `${frontendUrl}/verify-email.html?token=${verifyToken}`;
    await sendEmail(email,
      `Welcome to AIC Kapsowar HMS — ${jobTitle||role}`,
      `<h2>Welcome, ${firstName} ${lastName}</h2>
       <p>Your account has been created by the CEO/Hospital Director.</p>
       <p><strong>Staff ID:</strong> ${staffId}</p>
       <p><strong>Role:</strong> ${role.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</p>
       <p><strong>Temporary Password:</strong> ${tempPass}</p>
       <p>Please verify your email and change your password on first login:</p>
       <p><a href="${verifyUrl}">Verify Email & Get Started</a></p>
       <p style="color:#888;font-size:12px">AIC Kapsowar Hospital Management System</p>`
    );

    // Notify CEO
    await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url) VALUES($1,'general',$2,$3,'staff.html')`,
      [req.user.id, `✅ ${role.replace(/_/g,' ')} Registered`,
       `${firstName} ${lastName} (${staffId}) has been registered and notified by email.`]
    );

    // Audit log
    await query(`INSERT INTO audit_log(user_id,user_type,user_name,action,resource,resource_id,details,ip_address)
      VALUES($1,'staff',$2,'register_senior_staff','staff',$3,$4::jsonb,$5)`,
      [req.user.id, req.user.name||'CEO', newStaff.id,
       JSON.stringify({role,staffId,email}), req.ip||'unknown']
    );

    res.status(201).json({ ...newStaff, message: `${role.replace(/_/g,' ')} registered successfully. Welcome email sent.` });
  } catch(e) {
    if (e.code==='23505') return res.status(409).json({ error: 'Email or National ID already exists in the system' });
    res.status(500).json({ error: e.message });
  }
});

// ── HR: ASSIGN DEPARTMENT HEAD ────────────────────────────────────────────────
router.post('/hr/dept-heads', authMiddleware, rbacMiddleware('hr_officer','ceo','admin'), async (req,res) => {
  try {
    const { dept, staff_id } = req.body;
    if (!dept||!staff_id) return res.status(400).json({ error: 'Department and staff ID required' });

    // Get staff and dept details
    const [staffR, deptR] = await Promise.all([
      query('SELECT * FROM staff WHERE id=$1 AND is_active=TRUE',[staff_id]),
      query('SELECT * FROM departments WHERE code=$1',[dept])
    ]);
    if (!staffR.rows.length) return res.status(404).json({ error: 'Staff not found' });
    if (!deptR.rows.length) return res.status(404).json({ error: 'Department not found' });

    const staffMember = staffR.rows[0];
    const department = deptR.rows[0];

    // Remove old head flag
    await query(`UPDATE staff SET is_dept_head=FALSE, dept_head_of=NULL WHERE dept_head_of=$1`,[dept]);

    // Set new head
    await query(`UPDATE staff SET is_dept_head=TRUE, dept_head_of=$1 WHERE id=$2`,[dept,staff_id]);
    await query(`UPDATE departments SET dept_head_id=$1 WHERE code=$2`,[staff_id,dept]);

    // Notify the newly assigned dept head
    await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url,priority) VALUES($1,'general',$2,$3,'staff-portal.html','high')`,
      [staff_id, `🎖 Department Head Assignment`,
       `You have been assigned as Department Head of ${department.name} by HR. Your dashboard now includes department head privileges.`]
    );

    // Send email notification
    await sendEmail(staffMember.email,
      `Department Head Assignment — ${department.name}`,
      `<h2>Congratulations, ${staffMember.first_name}!</h2>
       <p>You have been assigned as <strong>Department Head of ${department.name}</strong> at AIC Kapsowar Hospital.</p>
       <p>This has been recorded in the HR system. Please log in to view your updated dashboard.</p>
       <p style="color:#888;font-size:12px">AIC Kapsowar Hospital Management System</p>`
    );

    // Audit
    await query(`INSERT INTO audit_log(user_id,user_type,user_name,action,resource,resource_id,details) VALUES($1,'staff',$2,'assign_dept_head','department',$3,$4::jsonb)`,
      [req.user.id,req.user.name||'HR',dept,JSON.stringify({staffId:staff_id,deptName:department.name})]
    );

    res.json({ message: `${staffMember.first_name} ${staffMember.last_name} assigned as head of ${department.name}. Email notification sent.` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/hr/dept-heads', authMiddleware, async (req,res) => {
  try {
    const r = await query(`SELECT d.code, d.name as dept_name, s.first_name||' '||s.last_name as head_name,
      s.staff_id, s.role, s.id as head_id
      FROM departments d LEFT JOIN staff s ON s.id=d.dept_head_id WHERE d.is_active=TRUE ORDER BY d.name`);
    res.json({ heads: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/hr/dept-heads/:dept', authMiddleware, rbacMiddleware('hr_officer','ceo','admin'), async (req,res) => {
  try {
    await query(`UPDATE staff SET is_dept_head=FALSE, dept_head_of=NULL WHERE dept_head_of=$1`,[req.params.dept]);
    await query(`UPDATE departments SET dept_head_id=NULL WHERE code=$1`,[req.params.dept]);
    res.json({ message: 'Department head removed' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── HR: CERTIFICATIONS ────────────────────────────────────────────────────────
router.get('/hr/certifications', authMiddleware, rbacMiddleware('hr_officer','ceo','admin'), async (req,res) => {
  try {
    const r = await query(`SELECT sc.*, s.first_name||' '||s.last_name as staff_name, s.dept_code
      FROM staff_certifications sc JOIN staff s ON s.id=sc.staff_id ORDER BY sc.expiry_date`);
    res.json({ certifications: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── HR: DISCIPLINE ────────────────────────────────────────────────────────────
router.get('/hr/discipline', authMiddleware, rbacMiddleware('hr_officer','ceo','admin'), async (req,res) => {
  try {
    const r = await query(`SELECT dr.*, s.first_name||' '||s.last_name as staff_name
      FROM disciplinary_records dr JOIN staff s ON s.id=dr.staff_id ORDER BY dr.created_at DESC`);
    res.json({ records: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/hr/discipline', authMiddleware, rbacMiddleware('hr_officer','ceo','admin'), async (req,res) => {
  try {
    const { staff_id, type, details, date } = req.body;
    if (!staff_id||!details||!date) return res.status(400).json({ error: 'All fields required' });
    const r = await query(`INSERT INTO disciplinary_records(staff_id,type,details,incident_date,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [staff_id,type||'verbal_warning',details,date,req.user.id]);
    // Notify staff
    await query(`INSERT INTO notifications(recipient_id,type,title,message,priority) VALUES($1,'general','⚠️ Disciplinary Notice','A disciplinary record has been added to your HR file. Please contact HR for details.','high')`,
      [staff_id]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BEDS ──────────────────────────────────────────────────────────────────────
router.get('/beds', authMiddleware, async (req,res) => {
  try {
    const { ward, status } = req.query;
    const conds=[]; const params=[];
    if (ward) { params.push(ward); conds.push(`ward=$${params.length}`); }
    if (status) { params.push(status); conds.push(`b.status=$${params.length}`); }
    const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
    const r = await query(`SELECT b.*, p.first_name||' '||p.last_name as patient_name, p.patient_id as pid
      FROM beds b LEFT JOIN patients p ON p.id=b.current_patient_id ${where} ORDER BY b.ward,b.bed_no`,params);
    res.json({ beds: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/beds/:id/admit', authMiddleware, async (req,res) => {
  try {
    const { patientId, journeyId } = req.body;
    const bed = await query('SELECT * FROM beds WHERE id=$1',[req.params.id]);
    if (!bed.rows.length) return res.status(404).json({ error: 'Bed not found' });
    if (bed.rows[0].status==='Occupied') return res.status(400).json({ error: 'Bed is already occupied' });

    // Generate admission no
    const cnt = await query('SELECT COUNT(*) FROM admissions');
    const admNo = `ADM${new Date().getFullYear()}${String(parseInt(cnt.rows[0].count)+1).padStart(5,'0')}`;

    await query(`UPDATE beds SET status='Occupied', current_patient_id=$1, admitted_at=NOW(), journey_id=$2 WHERE id=$3`,
      [patientId, journeyId||null, req.params.id]);
    const adm = await query(`INSERT INTO admissions(admission_no,patient_id,journey_id,bed_id,ward_code,admitting_doctor,admitting_diagnosis)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [admNo,patientId,journeyId||null,req.params.id,bed.rows[0].ward,req.user.id,req.body.diagnosis||null]);
    res.status(201).json(adm.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/beds/:id/discharge', authMiddleware, async (req,res) => {
  try {
    const { dischargeNotes, dischargeSummary } = req.body;
    const bed = await query('SELECT * FROM beds WHERE id=$1',[req.params.id]);
    if (!bed.rows.length) return res.status(404).json({ error: 'Bed not found' });

    await query(`UPDATE beds SET status='Available', current_patient_id=NULL, admitted_at=NULL, journey_id=NULL WHERE id=$1`,[req.params.id]);
    await query(`UPDATE admissions SET status='Discharged', discharge_date=CURRENT_DATE, discharge_time=NOW(),
      discharge_notes=$1, discharge_summary=$2 WHERE bed_id=$3 AND status='Admitted' RETURNING *`,
      [dischargeNotes||null, dischargeSummary||null, req.params.id]);
    res.json({ message: 'Patient discharged and bed freed' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VITALS ────────────────────────────────────────────────────────────────────
router.post('/vitals', authMiddleware, async (req,res) => {
  try {
    const { patientId, journeyId, admissionId, temperature, bpSys, bpDia, pulse,
            respiratory, oxygen, weight, height, bloodSugar, gcs, urgency, notes } = req.body;
    if (!patientId) return res.status(400).json({ error: 'Patient required' });
    const s = await query('SELECT first_name,last_name FROM staff WHERE id=$1',[req.user.id]);
    const st = s.rows[0];
    const r = await query(`INSERT INTO vitals(patient_id,journey_id,admission_id,recorded_by,recorder_name,
      temperature,blood_pressure_sys,blood_pressure_dia,pulse_rate,respiratory_rate,
      oxygen_saturation,weight,height,blood_sugar,gcs,urgency_classification,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [patientId,journeyId||null,admissionId||null,req.user.id,`${st.first_name} ${st.last_name}`,
       temperature||null,bpSys||null,bpDia||null,pulse||null,respiratory||null,
       oxygen||null,weight||null,height||null,bloodSugar||null,gcs||null,urgency||null,notes||null]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/vitals/:patientId', authMiddleware, async (req,res) => {
  try {
    const r = await query(`SELECT * FROM vitals WHERE patient_id=$1 ORDER BY recorded_at DESC LIMIT 20`,[req.params.patientId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── APPOINTMENTS V2 (request flow) ────────────────────────────────────────────
router.post('/appointments/request', authMiddleware, async (req,res) => {
  try {
    const { patientId, deptCode, preferredDoctorId, appointmentDate, reason } = req.body;
    if (!patientId||!deptCode||!appointmentDate) return res.status(400).json({ error: 'Patient, department and date required' });

    // Validate appointment date
    const apptDate = new Date(appointmentDate);
    if (apptDate < new Date()) return res.status(400).json({ error: 'Appointment date cannot be in the past' });
    const days = Math.ceil((apptDate-new Date())/(1000*60*60*24));
    if (days > 90) return res.status(400).json({ error: 'Cannot request appointments more than 90 days in advance' });
    if (apptDate.getDay()===0) return res.status(400).json({ error: 'Appointments not available on Sundays' });

    const cnt = await query('SELECT COUNT(*) FROM appointments');
    const apptNo = `APT${new Date().getFullYear()}${String(parseInt(cnt.rows[0].count)+1).padStart(5,'0')}`;

    const r = await query(`INSERT INTO appointments(appointment_no,patient_id,dept_code,preferred_doctor_id,
      appointment_date,appointment_time,reason,status,request_type,requested_by_patient)
      VALUES($1,$2,$3,$4,$5,$6,$7,'Pending','request',TRUE) RETURNING *`,
      [apptNo,patientId,deptCode,preferredDoctorId||null,appointmentDate,'09:00',reason||null]);

    // Notify dept head to assign
    const deptHead = await query(`SELECT id FROM staff WHERE dept_head_of=$1 AND is_dept_head=TRUE AND is_active=TRUE`,[deptCode]);
    if (deptHead.rows.length) {
      const pat = await query('SELECT first_name,last_name FROM patients WHERE id=$1',[patientId]);
      const pnm = pat.rows[0]?`${pat.rows[0].first_name} ${pat.rows[0].last_name}`:'A patient';
      await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url,priority) VALUES($1,'appointment',$2,$3,'appointments.html','high')`,
        [deptHead.rows[0].id, '📅 New Appointment Request',
         `${pnm} has requested an appointment in your department. Please assign a staff member and confirm the time.`]
      );
    }
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dept head assigns and confirms appointment
router.put('/appointments/:id/assign', authMiddleware, async (req,res) => {
  try {
    const { doctorId, appointmentDate, appointmentTime } = req.body;
    if (!doctorId||!appointmentDate||!appointmentTime) return res.status(400).json({ error: 'Doctor, date and time required' });

    // Validate time
    const [h,m] = appointmentTime.split(':').map(Number);
    if (h<8||h>=17) return res.status(400).json({ error: 'Appointment time must be between 08:00 and 17:00' });

    const r = await query(`UPDATE appointments SET doctor_id=$1, appointment_date=$2, appointment_time=$3,
      status='Confirmed', assigned_by=$4, assigned_at=NOW(), updated_at=NOW()
      WHERE id=$5 RETURNING *`,
      [doctorId,appointmentDate,appointmentTime,req.user.id,req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Appointment not found' });
    const appt = r.rows[0];

    // Get doctor name
    const doc = await query('SELECT first_name,last_name,email FROM staff WHERE id=$1',[doctorId]);
    const docName = doc.rows[0]?`${doc.rows[0].first_name} ${doc.rows[0].last_name}`:'your doctor';

    // Notify patient
    await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url,priority) VALUES($1,'appointment',$2,$3,'patient-dashboard.html','high')`,
      [appt.patient_id, '✅ Appointment Confirmed',
       `Your appointment has been confirmed: ${apptDate(appt.appointment_date)} at ${appt.appointment_time} with ${docName}.`]
    );

    // Notify assigned doctor
    const pat = await query('SELECT first_name,last_name,email FROM patients WHERE id=$1',[appt.patient_id]);
    const patName = pat.rows[0]?`${pat.rows[0].first_name} ${pat.rows[0].last_name}`:'A patient';
    await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url) VALUES($1,'appointment',$2,$3,'doctor-dashboard.html')`,
      [doctorId,'📅 New Appointment Assigned',
       `You have an appointment with ${patName} on ${appt.appointment_date} at ${appt.appointment_time}.`]
    );

    // Send email to patient
    if (pat.rows[0]?.email) {
      await sendEmail(pat.rows[0].email,
        'Appointment Confirmed — AIC Kapsowar Hospital',
        `<h2>Your Appointment is Confirmed</h2>
         <p>Dear ${pat.rows[0].first_name},</p>
         <p>Your appointment has been confirmed:</p>
         <ul><li><strong>Date:</strong> ${appt.appointment_date}</li>
         <li><strong>Time:</strong> ${appt.appointment_time}</li>
         <li><strong>Doctor:</strong> ${docName}</li></ul>
         <p>Please arrive 15 minutes early. Call +254757632293 to cancel.</p>
         <p style="color:#888;font-size:12px">AIC Kapsowar Hospital</p>`
      );
    }

    // Send email to doctor
    if (doc.rows[0]?.email) {
      await sendEmail(doc.rows[0].email,
        'New Appointment Assigned — AIC Kapsowar HMS',
        `<h2>Appointment Assigned</h2>
         <p>You have a new appointment: <strong>${patName}</strong> on <strong>${appt.appointment_date} at ${appt.appointment_time}</strong></p>
         <p style="color:#888;font-size:12px">AIC Kapsowar HMS</p>`
      );
    }

    res.json({ ...appt, message: 'Appointment confirmed. Patient and doctor notified by email.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Appointment reminders (24h before)
router.get('/appointments/upcoming-reminders', authMiddleware, async (req,res) => {
  try {
    const tomorrow = new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0];
    const r = await query(`SELECT a.*, p.first_name||' '||p.last_name as patient_name, p.email as patient_email,
      s.first_name||' '||s.last_name as doctor_name, s.email as doctor_email
      FROM appointments a JOIN patients p ON p.id=a.patient_id
      LEFT JOIN staff s ON s.id=a.doctor_id
      WHERE a.appointment_date=$1 AND a.status='Confirmed' AND a.reminder_sent=FALSE`,[tomorrow]);
    res.json({ appointments: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WIFI CONTROL ──────────────────────────────────────────────────────────────
router.get('/wifi/status', authMiddleware, async (req,res) => {
  try {
    const r = await query('SELECT * FROM wifi_access_control ORDER BY changed_at DESC LIMIT 1');
    const ex = await query(`SELECT we.*, s.first_name||' '||s.last_name as staff_name, s.staff_id, s.dept_code
      FROM wifi_exemptions we JOIN staff s ON s.id=we.staff_id
      WHERE we.is_active=TRUE AND (we.expires_at IS NULL OR we.expires_at > NOW())`);
    res.json({ restriction: r.rows[0], exemptions: ex.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/wifi/toggle', authMiddleware, rbacMiddleware('ceo','admin'), async (req,res) => {
  try {
    const { enabled, reason } = req.body;
    await query(`INSERT INTO wifi_access_control(restriction_enabled,changed_by,reason) VALUES($1,$2,$3)`,
      [enabled!==false, req.user.id, reason||null]);
    await query(`INSERT INTO audit_log(user_id,user_type,user_name,action,resource,details) VALUES($1,'staff',$2,'wifi_toggle','wifi_control',$3::jsonb)`,
      [req.user.id,req.user.name||'CEO',JSON.stringify({enabled,reason})]);
    res.json({ message: `WiFi restriction ${enabled?'enabled':'disabled'}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/wifi/exemptions', authMiddleware, rbacMiddleware('ceo','admin'), async (req,res) => {
  try {
    const { staff_id, reason, expires_at } = req.body;
    if (!staff_id) return res.status(400).json({ error: 'Staff required' });
    // Deactivate any existing exemption
    await query(`UPDATE wifi_exemptions SET is_active=FALSE WHERE staff_id=$1`,[staff_id]);
    const r = await query(`INSERT INTO wifi_exemptions(staff_id,granted_by,reason,expires_at) VALUES($1,$2,$3,$4) RETURNING *`,
      [staff_id,req.user.id,reason||null,expires_at||null]);
    await query(`UPDATE staff SET remote_access_allowed=TRUE, remote_access_expiry=$1 WHERE id=$2`,[expires_at||null,staff_id]);

    // Notify staff
    const st = await query('SELECT first_name,email FROM staff WHERE id=$1',[staff_id]);
    if (st.rows[0]) {
      await query(`INSERT INTO notifications(recipient_id,type,title,message,priority) VALUES($1,'general','📡 Remote Access Granted','You have been granted remote access to the HMS.'${expires_at?` + '. Access expires: ' + '${expires_at}'`:''},'high')`,
        [staff_id]);
      await sendEmail(st.rows[0].email, 'Remote Access Granted — AIC Kapsowar HMS',
        `<p>Dear ${st.rows[0].first_name},</p><p>Remote access to the HMS has been granted to you.${expires_at?` This access expires on ${expires_at}.`:''}</p>
         <p><strong>Note:</strong> All activity while accessing remotely is logged.</p>
         <p style="color:#888;font-size:12px">AIC Kapsowar HMS</p>`);
    }

    await query(`INSERT INTO audit_log(user_id,user_type,user_name,action,resource,resource_id,details) VALUES($1,'staff',$2,'wifi_exemption_grant','staff',$3,$4::jsonb)`,
      [req.user.id,req.user.name||'CEO',staff_id,JSON.stringify({reason,expires_at})]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/wifi/exemptions/:staffId', authMiddleware, rbacMiddleware('ceo','admin'), async (req,res) => {
  try {
    await query(`UPDATE wifi_exemptions SET is_active=FALSE WHERE staff_id=$1`,[req.params.staffId]);
    await query(`UPDATE staff SET remote_access_allowed=FALSE, remote_access_expiry=NULL WHERE id=$1`,[req.params.staffId]);
    await query(`INSERT INTO audit_log(user_id,user_type,user_name,action,resource,resource_id) VALUES($1,'staff',$2,'wifi_exemption_revoke','staff',$3)`,
      [req.user.id,req.user.name||'CEO',req.params.staffId]);
    res.json({ message: 'Remote access revoked' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PRICE CATALOGUE ───────────────────────────────────────────────────────────
router.get('/prices', authMiddleware, async (req,res) => {
  try {
    const { category } = req.query;
    const r = await query(`SELECT * FROM price_catalogue WHERE is_active=TRUE ${category?'AND category=$1':''}
      ORDER BY category,name`, category?[category]:[]);
    res.json({ prices: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/prices', authMiddleware, rbacMiddleware('finance_manager','accountant','ceo','admin'), async (req,res) => {
  try {
    const { category, name, description, private_price, nhif_price, nhif_covered } = req.body;
    if (!category||!name||private_price===undefined) return res.status(400).json({ error: 'Category, name and price required' });
    const r = await query(`INSERT INTO price_catalogue(category,name,description,private_price,nhif_price,nhif_covered,changed_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [category,name,description||null,private_price,nhif_price||0,nhif_covered||false,req.user.id]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/prices/:id', authMiddleware, rbacMiddleware('finance_manager','accountant','ceo','admin'), async (req,res) => {
  try {
    const { private_price, nhif_price, change_reason, requires_approval } = req.body;
    const existing = await query('SELECT * FROM price_catalogue WHERE id=$1',[req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Price not found' });
    const old = existing.rows[0];
    const pctChange = Math.abs((private_price - old.private_price)/old.private_price * 100);

    // Large changes > 15% or consultation/ward/theatre go to approval
    if (pctChange > 15 || ['consultation','ward','theatre'].includes(old.category)) {
      // Create approval request
      await query(`INSERT INTO price_change_requests(catalogue_id,item_name,current_price,proposed_price,reason,requested_by,effective_date)
        VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE+7)`,
        [req.params.id,old.name,old.private_price,private_price,change_reason||'Price update',req.user.id]);
      // Notify CEO
      const ceo = await query(`SELECT id FROM staff WHERE role='ceo' LIMIT 1`);
      if (ceo.rows.length) {
        await query(`INSERT INTO notifications(recipient_id,type,title,message,action_url,priority) VALUES($1,'billing','💰 Price Change Approval Required',$2,'price-catalogue.html','high')`,
          [ceo.rows[0].id, `Finance has requested a price change for ${old.name}: KES ${old.private_price} → KES ${private_price}. Approval required.`]
        );
      }
      return res.json({ message: 'Price change request submitted for CEO approval', requiresApproval: true });
    }

    // Small change — apply directly
    await query(`UPDATE price_catalogue SET private_price=$1, nhif_price=$2, previous_price=$3,
      changed_by=$4, change_reason=$5, updated_at=NOW() WHERE id=$6`,
      [private_price,nhif_price||old.nhif_price,old.private_price,req.user.id,change_reason||null,req.params.id]);
    res.json({ message: 'Price updated', requiresApproval: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CEO approves price changes
router.put('/prices/approve/:requestId', authMiddleware, rbacMiddleware('ceo','admin'), async (req,res) => {
  try {
    const { approve, comment } = req.body;
    const req_r = await query('SELECT * FROM price_change_requests WHERE id=$1',[req.params.requestId]);
    if (!req_r.rows.length) return res.status(404).json({ error: 'Request not found' });
    const pr = req_r.rows[0];

    await query(`UPDATE price_change_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW(), ceo_comment=$3 WHERE id=$4`,
      [approve?'Approved':'Declined',req.user.id,comment||null,req.params.requestId]);

    if (approve) {
      await query(`UPDATE price_catalogue SET private_price=$1, previous_price=$2, changed_by=$3, approved_by=$4, approved_at=NOW(), updated_at=NOW() WHERE id=$5`,
        [pr.proposed_price,pr.current_price,pr.requested_by,req.user.id,pr.catalogue_id]);
    }

    // Notify requester
    await query(`INSERT INTO notifications(recipient_id,type,title,message) VALUES($1,'billing',$2,$3)`,
      [pr.requested_by,
       approve?'✅ Price Change Approved':'❌ Price Change Declined',
       `Your price change request for ${pr.item_name} has been ${approve?'approved':'declined'}.${comment?' Note: '+comment:''}`]
    );
    res.json({ message: `Price change ${approve?'approved':'declined'}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────
router.post('/announcements', authMiddleware, rbacMiddleware('ceo','admin','hr_officer'), async (req,res) => {
  try {
    const { message, target } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
    const r = await query(`INSERT INTO announcements(message,created_by,target) VALUES($1,$2,$3) RETURNING *`,
      [message,req.user.id,target||'all']);
    // Notify all active staff
    await query(`INSERT INTO notifications(recipient_id,type,title,message,priority)
      SELECT id,'general','📢 Hospital Announcement',$1,'high' FROM staff WHERE is_active=TRUE`,[message]);
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/announcements/active', authMiddleware, async (req,res) => {
  try {
    const r = await query(`SELECT a.*, s.first_name||' '||s.last_name as created_by_name
      FROM announcements a LEFT JOIN staff s ON s.id=a.created_by
      WHERE a.is_active=TRUE AND a.expires_at > NOW() ORDER BY a.created_at DESC LIMIT 3`);
    res.json({ announcements: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CEO DASHBOARD STATS ───────────────────────────────────────────────────────
router.get('/ceo/stats', authMiddleware, rbacMiddleware('ceo','admin'), async (req,res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [patients,beds,staff,alerts,appts,rev,reports] = await Promise.all([
      query(`SELECT COUNT(*) FROM patient_journey WHERE visit_date=$1 AND status='active'`,[today]),
      query(`SELECT COUNT(*) FILTER(WHERE status='Occupied') as occupied, COUNT(*) as total FROM beds WHERE is_active=TRUE`),
      query(`SELECT COUNT(*) FILTER(WHERE status='Present' OR status='Late') as present, COUNT(*) as total FROM attendance WHERE attendance_date=$1`,[today]),
      query(`SELECT COUNT(*) FROM security_alerts WHERE status='active'`),
      query(`SELECT COUNT(*) FROM appointments WHERE appointment_date=$1 AND status NOT IN ('Cancelled')`,[today]),
      query(`SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE DATE(created_at)=$1`,[today]),
      query(`SELECT COUNT(*) FILTER(WHERE submitted=TRUE) as submitted, COUNT(*) as total FROM daily_reports WHERE report_date=$1`,[today])
    ]);
    res.json({
      activePatients: parseInt(patients.rows[0].count),
      bedsOccupied: parseInt(beds.rows[0].occupied),
      totalBeds: parseInt(beds.rows[0].total),
      staffPresent: parseInt(staff.rows[0].present||0),
      totalStaff: parseInt(staff.rows[0].total||0),
      activeAlerts: parseInt(alerts.rows[0].count),
      todayAppointments: parseInt(appts.rows[0].count),
      todayRevenue: parseFloat(rev.rows[0].total),
      submittedReports: parseInt(reports.rows[0].submitted||0),
      totalDeptReports: parseInt(reports.rows[0].total||0)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STAFF REGISTRATION (ALL STAFF VIA CEO/ADMIN/HR) ───────────────────────────
router.post('/staff/register', authMiddleware, rbacMiddleware('ceo','admin','hr_officer'), async (req,res) => {
  try {
    const { firstName, middleName, lastName, email, phone, role, deptCode,
            jobTitle, nationalId, dateOfBirth, gender, county, town,
            qualification, licenceNo, kinName, kinRelation, kinPhone, startDate } = req.body;

    if (!firstName||!lastName||!email||!phone||!role||!deptCode) {
      return res.status(400).json({ error: 'Required: firstName, lastName, email, phone, role, deptCode' });
    }

    // Phone validation
    const cleanPhone = phone.replace(/[\s\-]/g,'');
    if (!/^(\+?254|0)[17]\d{8}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'Invalid Kenyan phone number format' });
    }

    // Age validation
    if (dateOfBirth) {
      const age = Math.floor((Date.now()-new Date(dateOfBirth))/(1000*60*60*24*365.25));
      if (age<18||age>70) return res.status(400).json({ error: 'Staff age must be between 18 and 70' });
    }

    // Generate staff ID
    const dept = (deptCode||'ADM').toUpperCase().slice(0,4);
    const cnt = await query(`SELECT COUNT(*) FROM staff WHERE staff_id LIKE $1`,[dept+'%']);
    const staffId = `${dept}${String(parseInt(cnt.rows[0].count)+1).padStart(4,'0')}`;

    const bcrypt = (await import('bcrypt')).default;
    const crypto = (await import('crypto')).default;
    const tempPass = `${dept}@AIC${new Date().getFullYear()}#`;
    const hash = await bcrypt.hash(tempPass, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now()+48*60*60*1000);

    const r = await query(`
      INSERT INTO staff(staff_id,first_name,middle_name,last_name,email,phone,role,dept_code,
        job_title,national_id,date_of_birth,gender,county,town,qualification,licence_no,
        kin_name,kin_relation,kin_phone,start_date,password_hash,
        email_verification_token,email_token_expires,must_change_password,registered_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,TRUE,$24)
      RETURNING id,staff_id,first_name,last_name,email,role,dept_code`,
      [staffId,firstName,middleName||null,lastName,email,cleanPhone,role,deptCode,
       jobTitle||role.replace(/_/g,' '),nationalId||null,dateOfBirth||null,gender||null,
       county||null,town||null,qualification||null,licenceNo||null,
       kinName||null,kinRelation||null,kinPhone||null,startDate||null,
       hash,verifyToken,verifyExpires,req.user.id]
    );
    const newStaff = r.rows[0];
    await query(`INSERT INTO leave_balances(staff_id) VALUES($1) ON CONFLICT DO NOTHING`,[newStaff.id]);

    // Welcome email
    const frontendUrl = process.env.FRONTEND_URL||'http://localhost:5500/frontend/pages';
    await sendEmail(email,`Welcome to AIC Kapsowar HMS`,
      `<h2>Welcome, ${firstName} ${lastName}!</h2>
       <p><strong>Staff ID:</strong> ${staffId}<br>
       <strong>Temporary Password:</strong> ${tempPass}</p>
       <p><a href="${frontendUrl}/verify-email.html?token=${verifyToken}">Verify Email & Login</a></p>
       <p style="color:#888;font-size:12px">AIC Kapsowar Hospital — You must change your password on first login.</p>`
    );

    await query(`INSERT INTO audit_log(user_id,user_type,user_name,action,resource,resource_id,details) VALUES($1,'staff',$2,'register_staff','staff',$3,$4::jsonb)`,
      [req.user.id,req.user.name||'Admin',newStaff.id,JSON.stringify({role,staffId,email})]);

    res.status(201).json({...newStaff, message: 'Staff registered. Welcome email sent.'});
  } catch(e) {
    if (e.code==='23505') return res.status(409).json({ error: 'Email or National ID already registered' });
    if (e.code==='23514') return res.status(400).json({ error: 'Age constraint: staff must be 18–70 years old' });
    res.status(500).json({ error: e.message });
  }
});

// ── PATIENT DASHBOARD API ─────────────────────────────────────────────────────
router.get('/patient/dashboard/:patientId', authMiddleware, async (req,res) => {
  try {
    const pid = req.params.patientId;
    const [visits,labs,prescriptions,invoices,appointments,vitals] = await Promise.all([
      query(`SELECT * FROM patient_journey WHERE patient_id=$1 ORDER BY visit_date DESC LIMIT 10`,[pid]),
      query(`SELECT * FROM lab_requests WHERE patient_id=$1 AND status='Completed' ORDER BY reported_at DESC LIMIT 5`,[pid]),
      query(`SELECT * FROM prescriptions WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 5`,[pid]),
      query(`SELECT * FROM invoices WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 5`,[pid]),
      query(`SELECT a.*, s.first_name||' '||s.last_name as doctor_name FROM appointments a LEFT JOIN staff s ON s.id=a.doctor_id WHERE a.patient_id=$1 ORDER BY a.appointment_date DESC LIMIT 10`,[pid]),
      query(`SELECT * FROM vitals WHERE patient_id=$1 ORDER BY recorded_at DESC LIMIT 6`,[pid])
    ]);
    res.json({
      visits: visits.rows, labs: labs.rows, prescriptions: prescriptions.rows,
      invoices: invoices.rows, appointments: appointments.rows, vitals: vitals.rows,
      pendingPrescription: prescriptions.rows.find(p=>p.status==='Pending'),
      outstandingBalance: invoices.rows.reduce((s,i)=>s+parseFloat(i.balance||0),0),
      nextAppointment: appointments.rows.find(a=>new Date(a.appointment_date)>=new Date()&&a.status==='Confirmed')
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Helper
function apptDate(d){return d?new Date(d).toLocaleDateString('en-KE',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}):'';}
