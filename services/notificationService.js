/**
 * AIC Kapsowar HMS v9 — Notification Service
 * Centralised in-app + email notifications for all workflow events
 */

import { query } from '../config/database.js';
import nodemailer from 'nodemailer';

const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  || process.env.SMTP_USER;
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASS;
const SMTP_HOST    = process.env.SMTP_HOST    || 'smtp.gmail.com';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://192.168.1.5:5000')
                      .replace(/\/frontend\/pages\/?$/, '');

// ── TRANSPORTER ─────────────────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST, port: 587, secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false }
  });
}

async function sendMail(to, subject, html) {
  if (!to || !SMTP_USER || !SMTP_PASS) return false;
  try {
    const t = getTransporter();
    await t.sendMail({
      from: `"AIC Kapsowar HMS" <${SMTP_USER}>`,
      to, subject, html
    });
    return true;
  } catch (e) {
    console.error('[NOTIFY EMAIL ERROR]', e.message);
    return false;
  }
}

// ── EMAIL WRAPPER ────────────────────────────────────────────────
function wrap(body) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0f1c;font-family:Arial,sans-serif">
  <div style="max-width:580px;margin:20px auto;background:#12100a;border:1px solid #3a2a08;border-radius:16px;overflow:hidden">
    <div style="background:#1a1408;padding:18px 24px;border-bottom:1px solid #3a2a08;display:flex;align-items:center;gap:12px">
      <div style="font-size:18px;font-weight:800;color:#C8860A">AIC Kapsowar Hospital</div>
      <div style="font-size:11px;color:#7a6a58">HMS v9 Notification</div>
    </div>
    <div style="padding:24px">${body}</div>
    <div style="padding:12px 24px;border-top:1px solid #1a1408;text-align:center;font-size:11px;color:#5a4a38">
      AIC Kapsowar Hospital · Kapsowar, Elgeyo-Marakwet, Kenya · aic.admin0001@gmail.com
    </div>
  </div></body></html>`;
}
function goldBox(t)  { return `<div style="background:rgba(200,134,10,.1);border:1px solid rgba(200,134,10,.3);border-radius:8px;padding:12px;margin:12px 0;color:#f0e8d8;font-size:13px">${t}</div>`; }
function redBox(t)   { return `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:12px;margin:12px 0;color:#fecaca;font-size:13px">${t}</div>`; }
function greenBox(t) { return `<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:12px;margin:12px 0;color:#bbf7d0;font-size:13px">${t}</div>`; }
function blueBox(t)  { return `<div style="background:rgba(30,107,255,.1);border:1px solid rgba(30,107,255,.3);border-radius:8px;padding:12px;margin:12px 0;color:#bfdbfe;font-size:13px">${t}</div>`; }
function cred(k, v)  { return `<div style="display:flex;justify-content:space-between;padding:8px 12px;background:#1a1408;border-radius:6px;margin:4px 0"><span style="color:#7a6a58;font-size:12px">${k}</span><strong style="color:#C8860A;font-family:monospace">${v}</strong></div>`; }
function btn(label, url) { return `<div style="text-align:center;margin:20px 0"><a href="${url}" style="background:#C8860A;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">${label}</a></div>`; }

// ── SAVE IN-APP NOTIFICATION ────────────────────────────────────
async function saveNotification({ recipientStaffId, recipientPatientId, type, title, message, link, priority = 'normal' }) {
  try {
    await query(
      `INSERT INTO notifications (recipient_staff_id, recipient_patient_id, type, title, message, link, priority, created_at, read)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),false)`,
      [recipientStaffId || null, recipientPatientId || null, type, title, message, link || null, priority]
    );
  } catch (e) {
    console.error('[NOTIFY DB ERROR]', e.message);
  }
}

// ── HELPER: get staff email by role/dept ─────────────────────────
async function getStaffByDept(dept) {
  const r = await query(
    `SELECT staff_id, first_name, last_name, email FROM staff WHERE department=$1 AND is_active=true AND email IS NOT NULL`,
    [dept]
  );
  return r.rows;
}
async function getStaffById(staffId) {
  const r = await query(`SELECT * FROM staff WHERE staff_id=$1`, [staffId]);
  return r.rows[0] || null;
}
async function getPatientById(patientId) {
  const r = await query(`SELECT * FROM patients WHERE patient_id=$1`, [patientId]);
  return r.rows[0] || null;
}
async function getAllAdmins() {
  const r = await query(`SELECT staff_id, first_name, last_name, email FROM staff WHERE role='admin' AND is_active=true AND email IS NOT NULL`);
  return r.rows;
}
async function getAllClinicalStaff() {
  const r = await query(`SELECT staff_id, email FROM staff WHERE role IN ('doctor','nurse','triage') AND is_active=true AND email IS NOT NULL`);
  return r.rows;
}

// ════════════════════════════════════════════════════════════════
// 1. TRIAGE → DEPARTMENT FORWARDED
// ════════════════════════════════════════════════════════════════
export async function notifyDeptPatientForwarded({ patientId, patientName, fromDept, toDept, vitals, triageStaffId, urgency = 'normal' }) {
  const destStaff = await getStaffByDept(toDept);
  const isEmergency = urgency === 'emergency' || toDept === 'EMG';

  for (const s of destStaff) {
    // In-app
    await saveNotification({
      recipientStaffId: s.staff_id,
      type: isEmergency ? 'emergency' : 'patient_forwarded',
      title: isEmergency ? `🚨 EMERGENCY: Patient ${patientName}` : `🏥 Patient Forwarded to ${toDept}`,
      message: `${patientName} (${patientId}) forwarded from ${fromDept}. ${vitals ? `BP: ${vitals.bp}, Temp: ${vitals.temp}°C, SpO2: ${vitals.spo2}%` : ''}`,
      link: `/doctor-dashboard.html`,
      priority: isEmergency ? 'critical' : 'high'
    });

    // Email
    if (s.email) {
      const html = wrap(`
        <h3 style="color:#C8860A;margin:0 0 12px">${isEmergency ? '🚨 EMERGENCY PATIENT ARRIVAL' : '🏥 Patient Forwarded to Your Department'}</h3>
        <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${s.first_name}</strong>, a patient has been forwarded to <strong style="color:#C8860A">${toDept}</strong>.</p>
        ${cred('Patient', patientName)}
        ${cred('Patient ID', patientId)}
        ${cred('From Department', fromDept)}
        ${cred('Forwarded By', triageStaffId)}
        ${vitals ? `
          ${cred('Blood Pressure', vitals.bp || 'N/A')}
          ${cred('Temperature', vitals.temp ? vitals.temp + '°C' : 'N/A')}
          ${cred('SpO2', vitals.spo2 ? vitals.spo2 + '%' : 'N/A')}
          ${cred('Pulse', vitals.pulse ? vitals.pulse + ' bpm' : 'N/A')}
          ${cred('Pain Level', vitals.pain !== undefined ? vitals.pain + '/10' : 'N/A')}
        ` : ''}
        ${isEmergency ? redBox('⚠️ EMERGENCY — This patient requires IMMEDIATE attention.') : goldBox('Please review this patient at your earliest convenience.')}
        ${btn('Open Dashboard', `${FRONTEND_URL}/doctor-dashboard.html`)}
      `);
      await sendMail(s.email, isEmergency ? `[AIC HMS] 🚨 EMERGENCY Patient: ${patientName}` : `[AIC HMS] Patient Forwarded: ${patientName} → ${toDept}`, html);
    }
  }

  // Emergency broadcast to ALL clinical staff
  if (isEmergency) {
    const allClinical = await getAllClinicalStaff();
    for (const s of allClinical) {
      await saveNotification({
        recipientStaffId: s.staff_id,
        type: 'emergency_broadcast',
        title: `🚨 EMERGENCY: ${patientName}`,
        message: `Emergency patient ${patientName} (${patientId}) arriving at ${toDept}. All available clinical staff please respond.`,
        link: `/doctor-dashboard.html`,
        priority: 'critical'
      });
    }
    // Email all admins too
    const admins = await getAllAdmins();
    for (const a of admins) {
      if (a.email) {
        await sendMail(a.email, `[AIC HMS] 🚨 EMERGENCY ALERT: ${patientName}`,
          wrap(`${redBox(`<strong>🚨 EMERGENCY PATIENT ALERT</strong><br>${patientName} (${patientId}) has been triaged as an emergency and forwarded to ${toDept}.`)}`));
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 2. LEAVE APPROVED / DENIED
// ════════════════════════════════════════════════════════════════
export async function notifyLeaveDecision({ staffId, status, leaveType, startDate, endDate, adminNote, approvedBy }) {
  const staff = await getStaffById(staffId);
  if (!staff) return;

  const approved = status === 'approved';
  const subj = approved ? `[AIC HMS] ✅ Leave Approved` : `[AIC HMS] ❌ Leave Request Denied`;
  const title = approved ? '✅ Leave Approved' : '❌ Leave Request Denied';

  await saveNotification({
    recipientStaffId: staffId,
    type: 'leave_decision',
    title,
    message: `Your ${leaveType} leave ${approved ? 'has been approved' : 'was not approved'}. ${startDate} – ${endDate}. ${adminNote ? 'Note: ' + adminNote : ''}`,
    link: `/leave-requests.html`,
    priority: 'high'
  });

  if (staff.email) {
    const html = wrap(`
      <h3 style="color:${approved ? '#22c55e' : '#ef4444'};margin:0 0 12px">${title}</h3>
      <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${staff.first_name}</strong>, your leave request has been reviewed.</p>
      ${cred('Leave Type', leaveType)}
      ${cred('Start Date', startDate)}
      ${cred('End Date', endDate)}
      ${cred('Status', approved ? '✅ APPROVED' : '❌ DENIED')}
      ${cred('Reviewed By', approvedBy)}
      ${adminNote ? cred('Admin Note', adminNote) : ''}
      ${approved ? greenBox('Your leave has been approved. Please ensure your duties are covered before your leave starts.') : redBox('Your leave request was not approved. Please speak with your supervisor or submit a revised request.')}
      ${btn('View My Leave', `${FRONTEND_URL}/leave-requests.html`)}
    `);
    await sendMail(staff.email, subj, html);
  }
}

// ════════════════════════════════════════════════════════════════
// 3. REPORT REVIEWED / ESCALATED
// ════════════════════════════════════════════════════════════════
export async function notifyReportAction({ staffId, reportId, action, adminNote, escalateTo }) {
  const staff = await getStaffById(staffId);
  if (!staff) return;

  const title = action === 'escalated' ? '⬆️ Report Escalated' : action === 'reviewed' ? '✅ Report Reviewed' : `📋 Report ${action}`;

  await saveNotification({
    recipientStaffId: staffId,
    type: 'report_action',
    title,
    message: `Your daily report has been ${action}. ${adminNote ? 'Note: ' + adminNote : ''}`,
    link: `/my-reports.html`,
    priority: 'normal'
  });

  if (staff.email) {
    const html = wrap(`
      <h3 style="color:#C8860A;margin:0 0 12px">${title}</h3>
      <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${staff.first_name}</strong>, your daily report has been updated.</p>
      ${cred('Report ID', reportId)}
      ${cred('Action', action.toUpperCase())}
      ${adminNote ? cred('Admin Note', adminNote) : ''}
      ${goldBox('Please log in to view full details.')}
      ${btn('View My Reports', `${FRONTEND_URL}/my-reports.html`)}
    `);
    await sendMail(staff.email, `[AIC HMS] Report ${action}: ${reportId}`, html);
  }

  // If escalated, notify the escalation target
  if (action === 'escalated' && escalateTo) {
    const target = await getStaffById(escalateTo);
    if (target) {
      await saveNotification({
        recipientStaffId: escalateTo,
        type: 'report_escalated_to_you',
        title: `⬆️ Report Escalated To You`,
        message: `Report ${reportId} from ${staff.first_name} ${staff.last_name} has been escalated to you for review.`,
        link: `/admin-reports.html`,
        priority: 'high'
      });
      if (target.email) {
        const html = wrap(`
          <h3 style="color:#ef4444;margin:0 0 12px">⬆️ Report Escalated To You</h3>
          <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${target.first_name}</strong>, a report has been escalated for your review.</p>
          ${cred('Report ID', reportId)}
          ${cred('Submitted By', `${staff.first_name} ${staff.last_name} (${staffId})`)}
          ${adminNote ? cred('Admin Note', adminNote) : ''}
          ${redBox('Action required — please review this escalated report.')}
          ${btn('Review Reports', `${FRONTEND_URL}/admin-reports.html`)}
        `);
        await sendMail(target.email, `[AIC HMS] ⬆️ Escalated Report: ${reportId}`, html);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 4. INVOICE CREATED → NOTIFY PATIENT
// ════════════════════════════════════════════════════════════════
export async function notifyInvoiceCreated({ patientId, invoiceId, items, total, dueDate }) {
  const patient = await getPatientById(patientId);
  if (!patient) return;

  await saveNotification({
    recipientPatientId: patientId,
    type: 'invoice_created',
    title: '💳 Invoice Ready',
    message: `Your invoice (${invoiceId}) of KES ${total.toLocaleString()} is ready. Please visit finance to settle your bill.`,
    link: `/patient-dashboard.html`,
    priority: 'high'
  });

  if (patient.email) {
    const itemsHtml = (items || []).map(i =>
      `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1408;font-size:13px">
        <span style="color:#b8a898">${i.description}</span>
        <span style="color:#f0e8d8">KES ${(i.amount || 0).toLocaleString()}</span>
      </div>`
    ).join('');

    const html = wrap(`
      <h3 style="color:#C8860A;margin:0 0 12px">💳 Your Invoice is Ready</h3>
      <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${patient.first_name}</strong>, your hospital invoice has been generated.</p>
      ${cred('Invoice ID', invoiceId)}
      ${cred('Patient ID', patientId)}
      ${dueDate ? cred('Due Date', dueDate) : ''}
      ${itemsHtml ? `<div style="margin:12px 0;border:1px solid #3a2a08;border-radius:8px;padding:12px">${itemsHtml}</div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:10px 12px;background:#1a1408;border-radius:6px;margin:8px 0">
        <strong style="color:#f0e8d8">TOTAL</strong>
        <strong style="color:#C8860A;font-size:18px">KES ${(total || 0).toLocaleString()}</strong>
      </div>
      ${goldBox('Please visit the Finance desk or pay via M-PESA to settle your bill. Reference your Invoice ID when paying.')}
      ${btn('View in Patient Portal', `${FRONTEND_URL}/patient-dashboard.html`)}
    `);
    await sendMail(patient.email, `[AIC Kapsowar] Invoice ${invoiceId} — KES ${total.toLocaleString()}`, html);
  }
}

// ════════════════════════════════════════════════════════════════
// 5. PAYMENT RECEIVED → NOTIFY PATIENT
// ════════════════════════════════════════════════════════════════
export async function notifyPaymentReceived({ patientId, invoiceId, amount, method, reference, receivedBy }) {
  const patient = await getPatientById(patientId);
  if (!patient) return;

  await saveNotification({
    recipientPatientId: patientId,
    type: 'payment_received',
    title: '✅ Payment Confirmed',
    message: `Payment of KES ${amount.toLocaleString()} received for invoice ${invoiceId} via ${method}.`,
    link: `/patient-dashboard.html`,
    priority: 'normal'
  });

  if (patient.email) {
    const html = wrap(`
      <h3 style="color:#22c55e;margin:0 0 12px">✅ Payment Received</h3>
      <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${patient.first_name}</strong>, we have received your payment. Thank you!</p>
      ${cred('Invoice ID', invoiceId)}
      ${cred('Amount Paid', `KES ${amount.toLocaleString()}`)}
      ${cred('Payment Method', method)}
      ${reference ? cred('Reference No.', reference) : ''}
      ${cred('Received By', receivedBy)}
      ${cred('Date', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}
      ${greenBox('✅ This is your official payment confirmation. Please keep this for your records.')}
      ${btn('View Receipt in Portal', `${FRONTEND_URL}/patient-dashboard.html`)}
    `);
    await sendMail(patient.email, `[AIC Kapsowar] Payment Confirmed — KES ${amount.toLocaleString()}`, html);
  }
}

// ════════════════════════════════════════════════════════════════
// 6. LOW DRUG STOCK ALERT
// ════════════════════════════════════════════════════════════════
export async function notifyLowDrugStock({ drugName, drugId, currentQty, threshold, dispensedBy }) {
  const admins = await getAllAdmins();
  const pharmacists = await getStaffByDept('PHA');
  const recipients = [...admins, ...pharmacists];

  const isCritical = currentQty === 0;
  const title = isCritical ? `🚨 OUT OF STOCK: ${drugName}` : `⚠️ Low Stock: ${drugName}`;
  const message = isCritical
    ? `${drugName} is OUT OF STOCK. Dispensed by ${dispensedBy}.`
    : `${drugName} has ${currentQty} units remaining (threshold: ${threshold}). Dispensed by ${dispensedBy}.`;

  const seen = new Set();
  for (const s of recipients) {
    if (seen.has(s.staff_id)) continue;
    seen.add(s.staff_id);

    await saveNotification({
      recipientStaffId: s.staff_id,
      type: isCritical ? 'out_of_stock' : 'low_stock',
      title,
      message,
      link: `/pharmacy-dashboard.html`,
      priority: isCritical ? 'critical' : 'high'
    });

    if (s.email) {
      const html = wrap(`
        <h3 style="color:${isCritical ? '#ef4444' : '#f59e0b'};margin:0 0 12px">${title}</h3>
        <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${s.first_name}</strong>, a drug stock alert requires your attention.</p>
        ${cred('Drug Name', drugName)}
        ${cred('Drug ID', drugId)}
        ${cred('Current Stock', `${currentQty} units`)}
        ${cred('Minimum Threshold', `${threshold} units`)}
        ${cred('Last Dispensed By', dispensedBy)}
        ${isCritical ? redBox('🚨 CRITICAL: This drug is completely out of stock. Reorder immediately.') : goldBox(`⚠️ Stock is below the minimum threshold of ${threshold} units. Please reorder soon.`)}
        ${btn('Go to Pharmacy Dashboard', `${FRONTEND_URL}/pharmacy-dashboard.html`)}
      `);
      await sendMail(s.email, `[AIC HMS] ${isCritical ? '🚨 OUT OF STOCK' : '⚠️ Low Stock'}: ${drugName}`, html);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 7. LAB RESULTS READY → NOTIFY PATIENT + DOCTOR
// ════════════════════════════════════════════════════════════════
export async function notifyLabResultsReady({ patientId, testName, results, hasCritical, orderedByStaffId, labTechId }) {
  const patient = await getPatientById(patientId);

  // Notify doctor
  if (orderedByStaffId) {
    const flagMsg = hasCritical ? '⚠️ CRITICAL results detected — immediate review required.' : 'Results are ready for review.';
    await saveNotification({
      recipientStaffId: orderedByStaffId,
      type: hasCritical ? 'lab_critical' : 'lab_results',
      title: hasCritical ? `🚨 Critical Lab Result: ${testName}` : `🔬 Lab Result Ready: ${testName}`,
      message: `${testName} for patient ${patientId}. ${flagMsg}`,
      link: `/doctor-dashboard.html`,
      priority: hasCritical ? 'critical' : 'high'
    });
  }

  // Notify patient
  if (patient) {
    await saveNotification({
      recipientPatientId: patientId,
      type: 'lab_results',
      title: `🔬 Lab Results Ready: ${testName}`,
      message: `Your ${testName} results are now available in your patient portal.`,
      link: `/patient-dashboard.html`,
      priority: hasCritical ? 'high' : 'normal'
    });

    if (patient.email) {
      const resultRows = (results || []).map(r =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #1a1408;font-size:13px">
          <span style="color:#b8a898">${r.parameter}</span>
          <span style="color:${r.flag === 'Critical' ? '#ef4444' : r.flag === 'High' || r.flag === 'Low' ? '#f59e0b' : '#22c55e'};font-weight:700">${r.value} ${r.unit || ''} <span style="font-size:10px">(${r.flag || 'Normal'})</span></span>
        </div>`
      ).join('');

      const html = wrap(`
        <h3 style="color:#C8860A;margin:0 0 12px">🔬 Your Lab Results are Ready</h3>
        <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${patient.first_name}</strong>, your laboratory test results are now available.</p>
        ${cred('Test', testName)}
        ${cred('Patient ID', patientId)}
        ${resultRows ? `<div style="margin:12px 0;border:1px solid #3a2a08;border-radius:8px;padding:12px">${resultRows}</div>` : ''}
        ${hasCritical ? redBox('⚠️ One or more results are flagged as CRITICAL. Please contact the hospital or visit your doctor as soon as possible.') : blueBox('Your results are ready. Your doctor will review them and contact you if needed.')}
        ${btn('View Results in Portal', `${FRONTEND_URL}/patient-dashboard.html`)}
      `);
      await sendMail(patient.email, `[AIC Kapsowar] Lab Results: ${testName}`, html);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 8. WARD / INPATIENT ADMISSION
// ════════════════════════════════════════════════════════════════
export async function notifyWardAdmission({ patientId, patientName, wardName, bedNumber, admittedBy, diagnosis }) {
  const patient = await getPatientById(patientId);
  const admins = await getAllAdmins();
  const wardStaff = await getStaffByDept('INP');

  const message = `${patientName} admitted to ${wardName}, Bed ${bedNumber}. Diagnosis: ${diagnosis || 'Pending'}`;

  // Notify ward staff
  for (const s of wardStaff) {
    await saveNotification({
      recipientStaffId: s.staff_id,
      type: 'ward_admission',
      title: `🛏️ New Admission: ${patientName}`,
      message,
      link: `/doctor-dashboard.html`,
      priority: 'high'
    });
  }

  // Notify admins
  for (const a of admins) {
    await saveNotification({
      recipientStaffId: a.staff_id,
      type: 'ward_admission',
      title: `🛏️ Ward Admission: ${patientName}`,
      message,
      link: `/admin-dashboard.html`,
      priority: 'normal'
    });
  }

  // Notify patient/family
  if (patient && patient.email) {
    const html = wrap(`
      <h3 style="color:#C8860A;margin:0 0 12px">🛏️ Admission Confirmation</h3>
      <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${patient.first_name}</strong>, you have been admitted to AIC Kapsowar Hospital.</p>
      ${cred('Ward', wardName)}
      ${cred('Bed Number', bedNumber)}
      ${cred('Admitted By', admittedBy)}
      ${diagnosis ? cred('Diagnosis', diagnosis) : ''}
      ${goldBox('Your next of kin will be notified. For ward enquiries please contact the nurses\' station.')}
    `);
    await sendMail(patient.email, `[AIC Kapsowar] Admission Confirmation — Ward: ${wardName}`, html);
  }
}

// ════════════════════════════════════════════════════════════════
// 9. RESEND VERIFICATION EMAIL
// ════════════════════════════════════════════════════════════════
export async function resendVerificationEmail({ staffId, email, firstName, newToken }) {
  const verifyUrl = `${FRONTEND_URL}/verify-email.html?token=${newToken}&type=staff`;
  const html = wrap(`
    <h3 style="color:#C8860A;margin:0 0 12px">📧 Email Verification — New Link</h3>
    <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${firstName}</strong>, here is your new email verification link.</p>
    ${cred('Staff ID', staffId)}
    ${goldBox('Your previous link has expired. Click the button below to verify your email address.')}
    ${btn('✓ Verify Email Address', verifyUrl)}
    <p style="color:#5a4a38;font-size:12px;text-align:center">This link expires in 24 hours. If you did not request this, please contact admin.</p>
  `);
  return await sendMail(email, `[AIC HMS] New Verification Link — ${staffId}`, html);
}

export async function resendPatientVerificationEmail({ patientId, email, firstName, newToken }) {
  const verifyUrl = `${FRONTEND_URL}/verify-email.html?token=${newToken}&type=patient`;
  const html = wrap(`
    <h3 style="color:#C8860A;margin:0 0 12px">🏥 Patient Email Verification</h3>
    <p style="color:#b8a898;font-size:14px">Hello <strong style="color:#f0e8d8">${firstName}</strong>, here is your new email verification link for the AIC Kapsowar Patient Portal.</p>
    ${cred('Patient ID', patientId)}
    ${goldBox('Click the button below to verify your email and activate your patient portal.')}
    ${btn('✓ Verify Email Address', verifyUrl)}
    <p style="color:#5a4a38;font-size:12px;text-align:center">This link expires in 24 hours.</p>
  `);
  return await sendMail(email, `[AIC Kapsowar] Patient Verification — ${patientId}`, html);
}
