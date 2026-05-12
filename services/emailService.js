import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── ADMIN RECEIVING EMAIL (separate from SMTP sender to avoid self-send) ──
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://192.168.1.7:5000').replace(/\/frontend\/pages\/?$/, '');

// ── LOGO ATTACHMENT (CID inline — works in Gmail, Outlook, Apple Mail) ──
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logoPath = join(__dirname, '../../frontend/assets/logo.png');
const LOGO_EXISTS = existsSync(logoPath);

// Attachment object for nodemailer CID embedding
const logoAttachment = LOGO_EXISTS ? [{
  filename: 'logo.png',
  path: logoPath,
  cid: 'aiclogo@kapsowar',   // referenced as cid:aiclogo@kapsowar in HTML
  contentDisposition: 'inline'
}] : [];

// In HTML templates, use: <img src="cid:aiclogo@kapsowar">
const LOGO_SRC = 'cid:aiclogo@kapsowar';

// ── SHARED EMAIL WRAPPER ───────────────────────────────────────
function wrap(content) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#050a14;font-family:Arial,Helvetica,sans-serif}
  @media only screen and (max-width:600px){
    .email-card{border-radius:0!important}
    .email-pad{padding:20px 16px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#050a14">
<div style="max-width:580px;margin:0 auto;padding:20px 16px">
  <div class="email-card" style="background:#0a0f1c;border:1px solid #3a2a08;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.6)">

    <!-- African Pattern Band top -->
    <div style="height:5px;background:repeating-linear-gradient(90deg,#8B4513 0,#8B4513 8px,#C8860A 8px,#C8860A 16px,#1e6bff 16px,#1e6bff 24px,#050a14 24px,#050a14 32px,#C8860A 32px,#C8860A 40px,#8B4513 40px,#8B4513 48px)"></div>

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0a0f1c,#12100a);padding:22px 24px;border-bottom:2px solid #3a2a08">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td width="80" valign="middle">
          <div style="width:72px;height:72px;border-radius:50%;background:#fff;border:3px solid #C8860A;overflow:hidden;box-shadow:0 0 0 4px rgba(200,134,10,.2)">
            <img src="${LOGO_SRC}" alt="AIC Kapsowar Hospital" width="72" height="72" style="width:72px;height:72px;object-fit:contain;display:block">
          </div>
        </td>
        <td valign="middle" style="padding-left:16px">
          <div style="font-size:18px;font-weight:800;color:#f0e8d8;letter-spacing:.01em">AIC Kapsowar Hospital</div>
          <div style="font-size:11px;color:#C8860A;letter-spacing:.1em;text-transform:uppercase;margin-top:3px">AFRICA INLAND CHURCH · EST. 1966</div>
          <div style="font-size:10px;color:#7a6a58;margin-top:2px">Kapsowar, Elgeyo-Marakwet, Kenya</div>
        </td>
      </tr></table>
    </div>

    <!-- Content -->
    <div class="email-pad" style="padding:28px 28px 20px;color:#f0e8d8">
      ${content}
    </div>

    <!-- Bottom band -->
    <div style="height:3px;background:repeating-linear-gradient(90deg,#C8860A 0,#C8860A 8px,#8B4513 8px,#8B4513 16px,#1e6bff 16px,#1e6bff 24px)"></div>

    <!-- Footer -->
    <div style="padding:16px 24px;background:#050a14;text-align:center;border-top:1px solid #1a1408">
      <div style="font-size:11px;color:#7a6a58;line-height:1.8">
        AIC Kapsowar Hospital &nbsp;·&nbsp; P.O. Box 52-30705, Kapsowar<br>
        Elgeyo-Marakwet County, Kenya<br>
        Tel: +254 700 000 000 &nbsp;·&nbsp; info@aickapsowar.co.ke<br>
        <span style="color:#3a2a10;font-size:10px">This email is confidential. If received in error, please delete it and notify us immediately.</span>
      </div>
    </div>

  </div>
</div>
</body></html>`;
}

function goldBox(html) {
  return `<div style="background:#1a1408;border-left:4px solid #C8860A;border-radius:0 10px 10px 0;padding:14px 16px;margin:16px 0;font-size:13px;color:#e8a020">${html}</div>`;
}
function blueBox(html) {
  return `<div style="background:#0c1f35;border-left:4px solid #1e6bff;border-radius:0 10px 10px 0;padding:14px 16px;margin:16px 0;font-size:13px;color:#38bdf8">${html}</div>`;
}
function redBox(html) {
  return `<div style="background:#1a0505;border-left:4px solid #ef4444;border-radius:0 10px 10px 0;padding:14px 16px;margin:16px 0;font-size:13px;color:#ef4444">${html}</div>`;
}
function credBlock(label, value) {
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#12100a;border:1px solid #3a2a08;border-radius:8px;margin-bottom:8px">
    <tr>
      <td style="padding:10px 14px;font-size:12px;color:#7a6a58;text-transform:uppercase;letter-spacing:.05em">${label}</td>
      <td style="padding:10px 14px;font-family:monospace;font-size:18px;font-weight:900;color:#C8860A;letter-spacing:4px;text-align:right">${value}</td>
    </tr>
  </table>`;
}
function goldButton(text, url) {
  return `<div style="text-align:center;margin:24px 0">
    <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#a06808,#C8860A);color:#fff;padding:15px 36px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;letter-spacing:.5px;box-shadow:0 4px 16px rgba(200,134,10,.3)">${text}</a>
  </div>`;
}

// ── SEND HELPER (always attaches logo) ────────────────────────
async function send(to, subject, html) {
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    attachments: logoAttachment
  });
}

// ── STAFF VERIFICATION ─────────────────────────────────────────
export const sendStaffVerification = async (to, name, staffId, verifyUrl) => {
  const html = wrap(`
    <h2 style="font-size:20px;font-weight:800;color:#C8860A;margin:0 0 8px">Welcome to AIC Kapsowar HMS</h2>
    <p style="color:#b8a898;margin:0 0 20px;font-size:14px">Hello <strong style="color:#f0e8d8">${name}</strong>, your staff account has been created. Please verify your email to activate it.</p>
    ${credBlock('Your Staff ID / Username', staffId)}
    ${goldBox('🔒 After verification you will use a 6-digit email code (MFA) on every login.')}
    ${goldButton('✓ Verify Email & Activate Account', verifyUrl)}
    <p style="color:#7a6a58;font-size:12px;text-align:center">This link expires in 24 hours. If you did not register, ignore this email.</p>
    <p style="color:#7a6a58;font-size:11px;text-align:center">Having trouble? Copy: <span style="color:#C8860A;word-break:break-all">${verifyUrl}</span></p>
  `);
  return send(to, `[AIC Kapsowar HMS] Verify Email — Staff ID: ${staffId}`, html);
};

// ── PATIENT VERIFICATION ───────────────────────────────────────
export const sendPatientVerification = async (to, name, patientId, verifyUrl, tempPassword = null, isTempPassword = false) => {
  const html = wrap(`
    <h2 style="font-size:20px;font-weight:800;color:#C8860A;margin:0 0 8px">Welcome to AIC Kapsowar Hospital</h2>
    <p style="color:#b8a898;margin:0 0 20px;font-size:14px">Hello <strong style="color:#f0e8d8">${name}</strong>, your patient account has been registered at AIC Kapsowar Hospital. Please verify your email to activate your patient portal access.</p>
    ${credBlock('Your Patient ID', patientId)}
    ${tempPassword ? credBlock('Your Temporary Password', tempPassword) : ''}
    ${isTempPassword ? goldBox('🔐 This is a <strong>temporary password</strong> generated by the hospital. You will be asked to change it on your first login to the patient portal.') : ''}
    ${goldBox('Keep your Patient ID and password safe — you will need them to log into the patient portal.')}
    ${goldButton('✓ Verify Email & Activate Account', verifyUrl)}
    <p style="color:#7a6a58;font-size:12px;text-align:center">This verification link expires in 24 hours.</p>
    <p style="color:#7a6a58;font-size:12px;text-align:center">After verifying, use the <strong style="color:#C8860A">Patient Login</strong> page — NOT the Staff Login page.</p>
    <div style="text-align:center;margin-top:12px">
      <a href="${FRONTEND_URL}/patient-login.html" style="display:inline-block;background:rgba(200,134,10,.15);color:#C8860A;padding:8px 20px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;border:1px solid rgba(200,134,10,.3)">→ Patient Login Portal</a>
    </div>
  `);
  return send(to, `[AIC Kapsowar] Welcome — Patient ID: ${patientId}`, html);
};

// ── LOGIN OTP ──────────────────────────────────────────────────
export const sendLoginOTP = async (to, name, otp, isStaff = false) => {
  const html = wrap(`
    <h2 style="font-size:20px;font-weight:800;color:#C8860A;margin:0 0 8px">${isStaff ? 'Staff Login Verification' : 'Patient Portal Login Code'}</h2>
    <p style="color:#b8a898;margin:0 0 20px;font-size:14px">Hello <strong style="color:#f0e8d8">${name}</strong>, here is your one-time login code:</p>
    <div style="text-align:center;margin:28px 0">
      <div style="display:inline-block;background:#12100a;border:3px solid #C8860A;border-radius:14px;padding:22px 44px;box-shadow:0 0 30px rgba(200,134,10,.2)">
        <div style="font-family:monospace;font-size:48px;font-weight:900;color:#e8a020;letter-spacing:18px">${otp}</div>
      </div>
      <div style="color:#7a6a58;font-size:12px;margin-top:14px">⏱ Expires in <strong style="color:#f0e8d8">10 minutes</strong>. Never share this code.</div>
    </div>
    ${redBox('⚠ AIC Kapsowar Hospital will <strong>never</strong> ask for this code by phone or message. If you did not request this, contact IT Security immediately.')}
  `);
  return send(to, `[AIC Kapsowar HMS] Your login code: ${otp}`, html);
};

// ── PASSWORD RESET ─────────────────────────────────────────────
export const sendPasswordReset = async (to, name, resetUrl) => {
  const html = wrap(`
    <h2 style="font-size:20px;font-weight:800;color:#C8860A;margin:0 0 8px">Password Reset Request</h2>
    <p style="color:#b8a898;margin:0 0 20px;font-size:14px">Hello <strong style="color:#f0e8d8">${name}</strong>, a password reset was requested for your AIC Kapsowar HMS account.</p>
    ${goldButton('🔑 Reset My Password', resetUrl)}
    ${redBox('⚠ This link expires in <strong>2 hours</strong>. If you did not request this, your account is safe — simply ignore this email.')}
    <p style="color:#7a6a58;font-size:11px;text-align:center">Having trouble? Copy: <span style="color:#C8860A;word-break:break-all">${resetUrl}</span></p>
  `);
  return send(to, `[AIC Kapsowar HMS] Password Reset Request`, html);
};

// ── BRUTE FORCE ALERT ──────────────────────────────────────────
export const sendBruteForceAlert = async (attackerIP, targetStaffId, attempts) => {
  const html = wrap(`
    <h2 style="font-size:20px;font-weight:800;color:#ef4444;margin:0 0 8px">🚨 Security Alert — Brute Force Detected</h2>
    <p style="color:#b8a898;margin:0 0 16px;font-size:14px">Automated security has detected a brute force login attack.</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#1a0505;border:1px solid #7f1d1d;border-radius:10px;margin-bottom:16px">
      <tr><td style="padding:10px 14px;color:#7a6a58;font-size:12px">Attacker IP</td><td style="padding:10px 14px;font-family:monospace;font-weight:700;color:#ef4444;text-align:right">${attackerIP}</td></tr>
      <tr><td style="padding:10px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #2a0a0a">Target Account</td><td style="padding:10px 14px;font-family:monospace;font-weight:700;color:#f0e8d8;text-align:right;border-top:1px solid #2a0a0a">${targetStaffId}</td></tr>
      <tr><td style="padding:10px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #2a0a0a">Failed Attempts</td><td style="padding:10px 14px;font-weight:700;color:#ef4444;text-align:right;border-top:1px solid #2a0a0a">${attempts}</td></tr>
      <tr><td style="padding:10px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #2a0a0a">Action Taken</td><td style="padding:10px 14px;font-weight:700;color:#22c55e;text-align:right;border-top:1px solid #2a0a0a">IP Blocked 30 min</td></tr>
    </table>
    ${blueBox('📋 Full details in the SIEM Audit Logs and Security Alerts dashboard.')}
  `);
  const adminTo = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  return send(adminTo, `[AIC Kapsowar HMS] 🚨 SECURITY ALERT — Brute Force: ${attackerIP}`, html);
};

// ── WELCOME (after first login pw change) ─────────────────────
export const sendWelcome = async (to, name, role, dept) => {
  const html = wrap(`
    <h2 style="font-size:20px;font-weight:800;color:#22c55e;margin:0 0 8px">🎉 Account Fully Activated!</h2>
    <p style="color:#b8a898;margin:0 0 16px;font-size:14px">Hello <strong style="color:#f0e8d8">${name}</strong>, your AIC Kapsowar HMS account is now fully active.</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#12100a;border:1px solid #3a2a08;border-radius:10px;margin-bottom:16px">
      <tr><td style="padding:10px 14px;color:#7a6a58;font-size:12px">Role</td><td style="padding:10px 14px;font-weight:700;color:#f0e8d8;text-align:right">${role}</td></tr>
      <tr><td style="padding:10px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #1a1408">Department</td><td style="padding:10px 14px;font-weight:700;color:#f0e8d8;text-align:right;border-top:1px solid #1a1408">${dept}</td></tr>
    </table>
    ${goldBox('All your actions are audit-logged for HIPAA/GDPR compliance. Contact IT Security if you notice anything suspicious.')}
  `);
  return send(to, `[AIC Kapsowar HMS] Welcome — Account Activated`, html);
};

// ── INTRUSION ALERT ────────────────────────────────────────────
export const sendIntrusionAlert = async ({ ip, profile, threat, existing, description, timestamp }) => {
  const html = wrap(`
    <h2 style="font-size:20px;font-weight:800;color:${threat.level==='critical'?'#ef4444':'#f59e0b'};margin:0 0 8px">🚨 ${threat.label}</h2>
    <p style="color:#b8a898;font-size:14px;margin:0 0 16px">An unauthorized external access attempt was detected on the AIC Kapsowar HMS.</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#1a0505;border:2px solid #7f1d1d;border-radius:12px;margin-bottom:16px">
      <tr><td colspan="2" style="padding:10px 14px;font-size:11px;font-weight:700;color:#7f1d1d;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #2a0a0a">🔍 Attacker Profile</td></tr>
      <tr><td style="padding:9px 14px;color:#7a6a58;font-size:12px">IP Address</td><td style="padding:9px 14px;font-family:monospace;font-weight:700;color:#ef4444;text-align:right">${ip}</td></tr>
      <tr><td style="padding:9px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #1a0505">Device</td><td style="padding:9px 14px;font-weight:600;color:#f0e8d8;text-align:right;border-top:1px solid #1a0505">${profile.device}</td></tr>
      <tr><td style="padding:9px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #1a0505">OS</td><td style="padding:9px 14px;font-weight:600;color:#f0e8d8;text-align:right;border-top:1px solid #1a0505">${profile.os}</td></tr>
      <tr><td style="padding:9px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #1a0505">Browser</td><td style="padding:9px 14px;font-weight:600;color:#f0e8d8;text-align:right;border-top:1px solid #1a0505">${profile.browser}</td></tr>
      <tr><td style="padding:9px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #1a0505">Path Attempted</td><td style="padding:9px 14px;font-family:monospace;color:#f59e0b;text-align:right;border-top:1px solid #1a0505">${profile.method} ${profile.path}</td></tr>
      <tr><td style="padding:9px 14px;color:#7a6a58;font-size:12px;border-top:1px solid #7f1d1d">Total Attempts</td><td style="padding:9px 14px;font-weight:900;color:#ef4444;font-size:18px;font-family:monospace;text-align:right;border-top:1px solid #7f1d1d">${existing.count}</td></tr>
    </table>
    ${existing.count >= 5 ? redBox(`⚠ HIGH RISK: This IP has made ${existing.count} attempts. Consider blocking at router level immediately.`) : ''}
    ${blueBox('Recommended: Log into HMS → Security Alerts to review. If repeat: block IP in router ACL.')}
    <p style="color:#5a4a38;font-size:11px;margin-top:16px;text-align:center">Incident ID: INC-${Date.now()} · ${timestamp}</p>
  `);
  const adminTo2 = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  return send(adminTo2, `[AIC Kapsowar HMS] 🚨 ${threat.label} — External IP: ${ip} (${existing.count} attempt${existing.count>1?'s':''})`, html);
};

export const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email service ready —', process.env.SMTP_USER);
    return true;
  } catch (err) {
    console.warn('⚠ Email service error:', err.message);
    return false;
  }
};
