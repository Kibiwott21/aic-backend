// ============================================================
// AIC KAPSOWAR HMS — Enhanced Intrusion Detection System
// Profiles every unauthorized access attempt in full detail
// Stores attacker fingerprint, geolocation, device info
// Sends real-time email alert to security admin
// ============================================================

import { query } from '../config/database.js';
import { sendIntrusionAlert } from '../services/emailService.js';

// ── ALLOWED NETWORKS ──────────────────────────────────────────
const ALLOWED_CIDRS = [
  '192.168.1.0/24',   // All AIC Kapsowar Hospital WiFi SSIDs
  '127.0.0.1/32',     // Localhost
  '::1/128',          // IPv6 localhost
  '::ffff:127.0.0.1', // IPv4-mapped IPv6 localhost
  '0.0.0.0/8',        // Development - local network
  '10.0.0.0/8',       // Private network
];

// ── ATTACK TRACKING (in-memory per IP) ───────────────────────
// Tracks repeated attempts from same IP
const attackTracker = new Map();
// { ip: { count, firstSeen, lastSeen, paths, userAgents, blocked } }

// ── IP UTILS ─────────────────────────────────────────────────
function ipToInt(ip) {
  return ip.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0;
}

function isInCIDR(ip, cidr) {
  try {
    if (ip === '::1' && cidr === '::1/128') return true;
    if (ip.includes(':') && !ip.startsWith('::ffff:')) return cidr.includes(':');
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    const [net, prefix] = cidr.split('/');
    if (net.includes(':')) return false;
    const mask = parseInt(prefix) === 32 ? 0xFFFFFFFF : ~(0xFFFFFFFF >>> parseInt(prefix));
    return (ipToInt(ip) & mask) === (ipToInt(net) & mask);
  } catch { return false; }
}

function getClientIP(req) {
  const raw = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function isAllowed(ip) {
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return ALLOWED_CIDRS.some(c => isInCIDR(clean, c));
}

// ── EXTRACT ATTACKER FINGERPRINT ─────────────────────────────
function buildAttackerProfile(req, ip) {
  const ua = req.headers['user-agent'] || 'Unknown';

  // Parse browser/OS from User-Agent
  let browser = 'Unknown Browser';
  let os      = 'Unknown OS';
  let device  = 'Unknown Device';

  if (/Chrome\/(\S+)/.test(ua))       browser = 'Chrome ' + ua.match(/Chrome\/([\d.]+)/)?.[1];
  else if (/Firefox\/(\S+)/.test(ua)) browser = 'Firefox ' + ua.match(/Firefox\/([\d.]+)/)?.[1];
  else if (/Safari\//.test(ua))       browser = 'Safari';
  else if (/Edge\/(\S+)/.test(ua))    browser = 'Edge ' + ua.match(/Edge\/([\d.]+)/)?.[1];
  else if (/MSIE|Trident/.test(ua))   browser = 'Internet Explorer';

  if (/Windows NT 10/.test(ua))       os = 'Windows 10/11';
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
  else if (/Mac OS X/.test(ua))       os = 'macOS ' + (ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g,'.') || '');
  else if (/Android/.test(ua))        os = 'Android ' + (ua.match(/Android ([\d.]+)/)?.[1] || '');
  else if (/iPhone|iPad/.test(ua))    os = 'iOS ' + (ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g,'.') || '');
  else if (/Linux/.test(ua))          os = 'Linux';

  if (/Mobile|Android|iPhone|iPad/.test(ua)) device = 'Mobile/Tablet';
  else device = 'Desktop/Laptop';

  const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct/Unknown';
  const lang     = req.headers['accept-language']?.split(',')[0] || 'Unknown';

  return {
    ip,
    browser,
    os,
    device,
    userAgent: ua.slice(0, 300),
    referrer:  referrer.slice(0, 200),
    language:  lang,
    path:      req.path,
    method:    req.method,
    timestamp: new Date().toISOString(),
    headers: {
      host:            req.headers['host'] || '',
      acceptLanguage:  req.headers['accept-language'] || '',
      acceptEncoding:  req.headers['accept-encoding'] || '',
      connection:      req.headers['connection'] || '',
      dnt:             req.headers['dnt'] || '',
      secFetchSite:    req.headers['sec-fetch-site'] || '',
    }
  };
}

// ── DETERMINE THREAT LEVEL ────────────────────────────────────
function getThreatLevel(count, path) {
  const sensitiveRoutes = ['/api/auth', '/api/staff', '/api/audit', '/api/patients'];
  const isSensitive = sensitiveRoutes.some(r => path.startsWith(r));

  if (count >= 20) return { level: 'critical', label: 'SUSTAINED ATTACK', color: '#ef4444' };
  if (count >= 10) return { level: 'high',     label: 'REPEATED INTRUSION', color: '#f59e0b' };
  if (count >= 5)  return { level: 'high',     label: 'MULTIPLE ATTEMPTS', color: '#f59e0b' };
  if (isSensitive) return { level: 'high',     label: 'SENSITIVE ROUTE PROBE', color: '#f59e0b' };
  return               { level: 'medium',    label: 'UNAUTHORIZED ACCESS', color: '#38bdf8' };
}

// ── MAIN MIDDLEWARE ────────────────────────────────────────────
export const wifiAccessControl = async (req, res, next) => {
  // Always allow health + network-status endpoints
  if (req.path === '/api/health' || req.path === '/api/network-status') return next();

  const ip = getClientIP(req);
  console.log(`[WiFi] IP: ${ip} | Path: ${req.method} ${req.path}`);

  if (isAllowed(ip)) {
    console.log(`[WiFi] ✅ ALLOWED: ${ip}`);
    req.clientIP = ip;
    return next();
  }
  
  console.log(`[WiFi] ❌ BLOCKED: ${ip} not in allowed list`);

  // ── UNAUTHORIZED ACCESS DETECTED ─────────────────────────
  const profile  = buildAttackerProfile(req, ip);
  const now      = Date.now();

  // Update attack tracker
  const existing = attackTracker.get(ip) || {
    count: 0, firstSeen: now, lastSeen: now,
    paths: new Set(), userAgents: new Set()
  };
  existing.count++;
  existing.lastSeen = now;
  existing.paths.add(req.path);
  existing.userAgents.add(profile.browser + ' / ' + profile.os);
  attackTracker.set(ip, existing);

  const threat   = getThreatLevel(existing.count, req.path);
  const isRepeat = existing.count > 1;

  // Build description
  const description = [
    `Unauthorized access attempt from external IP ${ip}.`,
    `Device: ${profile.device} | OS: ${profile.os} | Browser: ${profile.browser}`,
    `Language: ${profile.language} | Referrer: ${profile.referrer}`,
    `Attempted path: ${profile.method} ${req.path}`,
    `Total attempts from this IP: ${existing.count}`,
    `First seen: ${new Date(existing.firstSeen).toLocaleString('en-KE')}`,
    `Routes probed: ${[...existing.paths].join(', ')}`,
    `User-Agent: ${profile.userAgent.slice(0, 150)}`
  ].join(' | ');

  // ── SAVE TO DATABASE ──────────────────────────────────────
  try {
    // 1. Audit log entry
    await query(
      `INSERT INTO audit_logs
         (actor_id, actor_name, action, resource, method, status_code, ip_address, user_agent, severity, details, timestamp)
       VALUES ($1, $2, $3, $4, $5, 403, $6, $7, $8, $9::jsonb, NOW())`,
      [
        'EXTERNAL_INTRUDER',
        `${profile.device} · ${profile.os} · ${profile.browser}`,
        `UNAUTHORIZED_ACCESS_ATTEMPT (${existing.count} total from this IP)`,
        req.path, req.method, ip,
        profile.userAgent.slice(0, 200),
        threat.level,
        JSON.stringify({
          ip, browser: profile.browser, os: profile.os, device: profile.device,
          language: profile.language, referrer: profile.referrer,
          attemptNumber: existing.count, firstSeen: new Date(existing.firstSeen).toISOString(),
          pathsProbed: [...existing.paths], userAgents: [...existing.userAgents]
        })
      ]
    );

    // 2. Security alert (only create new alert every 5 attempts to avoid spam)
    if (existing.count === 1 || existing.count % 5 === 0) {
      await query(
        `INSERT INTO security_alerts
           (severity, category, title, description, source, source_ip, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
        [
          threat.level,
          'External Intrusion Attempt',
          `${threat.label} — IP: ${ip} (${existing.count} attempt${existing.count>1?'s':''})`,
          description,
          `${profile.device} · ${profile.browser} · ${profile.os}`,
          ip
        ]
      );

      // 3. Send email alert to security admin
      try {
        await sendIntrusionAlert({
          ip, profile, threat, existing,
          description, timestamp: new Date().toISOString()
        });
      } catch(emailErr) {
        console.warn('[IDS] Email alert failed:', emailErr.message);
      }
    }

    console.warn(`\x1b[31m[IDS] BLOCKED: ${ip} | ${profile.device} | ${profile.os} | ${profile.browser} | Attempt #${existing.count} | ${req.method} ${req.path}\x1b[0m`);

  } catch(dbErr) {
    console.error('[IDS] DB log failed:', dbErr.message);
    // Still block even if DB fails
  }

  // ── RETURN BLOCKING RESPONSE ──────────────────────────────
  return res.status(403).json({
    error: 'Access denied — AIC Kapsowar HMS is only accessible from hospital WiFi networks.',
    code: 'NOT_ON_HOSPITAL_WIFI',
    message: 'Please connect to AIC-Staff-Secure, AIC-Clinical or AIC-Patients WiFi.',
    allowedNetworks: ['AIC-Staff-Secure', 'AIC-Clinical', 'AIC-Patients'],
    incident: `INC-${Date.now()}`,
    warning: existing.count >= 5
      ? 'REPEATED_ACCESS_ATTEMPTS_DETECTED — Your activity has been logged and reported.'
      : 'This access attempt has been logged.'
  });
};

// Utility: check if client IP belongs to allowed networks
function isAllowed(ip) {
  const allowedSubnets = ["192.168.1.0/24"]; // adjust as needed
  // implement subnet check logic here
  return true; // placeholder
}

// ── NETWORK STATUS ENDPOINT ───────────────────────────────────
export const getNetworkStatus = (req, res) => {
  const ip = getClientIP(req);
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  res.json({
    clientIP: clean,
    isAllowed: isAllowed(clean),
    hospitalNetworks: [
      { ssid:'AIC-Staff-Secure', subnet:'192.168.1.0/24', roles:['staff','admin','doctor','nurse','receptionist'] },
      { ssid:'AIC-Clinical',     subnet:'192.168.1.0/24', roles:['doctor','nurse','lab_tech'] },
      { ssid:'AIC-Patients',     subnet:'192.168.1.0/24', roles:['patient'] },
    ],
    timestamp: new Date().toISOString()
  });
};

// ── WIFI ACCESS CONTROL MIDDLEWARE ───────────────────────
export const wifiAccessControl = (req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    const ip = getClientIP(req);
    const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

    if (!isAllowed(clean)) {
      return res.status(403).json({
        error: "Access denied — only hospital WiFi allowed",
        code: "NOT_ON_HOSPITAL_WIFI",
        allowedNetworks: ["AIC-Staff-Secure","AIC-Clinical","AIC-Patients"]
      });
    }
  }
  // In development, skip restriction
  next();
};

// ── ATTACK REPORT (for admin dashboard) ──────────────────────
export const getAttackReport = (req, res) => {
  const entries = [];
  for (const [ip, data] of attackTracker.entries()) {
    entries.push({
      ip,
      attempts:   data.count,
      firstSeen:  new Date(data.firstSeen).toISOString(),
      lastSeen:   new Date(data.lastSeen).toISOString(),
      pathsProbed:[...data.paths],
      devices:    [...data.userAgents],
      threat:     getThreatLevel(data.count, [...data.paths][0] || '/').level
    });
  }
  entries.sort((a, b) => b.attempts - a.attempts);
  res.json({
    totalUniqueIPs:    entries.length,
    totalAttempts:     entries.reduce((s, e) => s + e.attempts, 0),
    criticalThreats:   entries.filter(e => e.threat === 'critical').length,
    attackers:         entries,
    since:             new Date(Math.min(...entries.map(e => new Date(e.firstSeen).getTime()) || [Date.now()])).toISOString()
  });
};
