import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('\n❌ FATAL: JWT_SECRET is not set in .env — server cannot start securely.\n');
  process.exit(1);
}

export const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No authentication token provided' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export const rbacMiddleware = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Insufficient permissions for this action' });
  }
  next();
};

export const auditLog = (req, res, next) => {
  const originalSend = res.send.bind(res);
  res.send = function(data) {
    (async () => {
      try {
        if (req.user?.id) {
          const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
          await query(
            `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, resource, method, status_code, ip_address, user_agent, timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
            [req.user.id, req.user.name, req.user.role,
             `${req.method} ${req.path}`, req.path, req.method,
             res.statusCode, ip.slice(0,50), (req.headers['user-agent']||'').slice(0,200)]
          );
        }
      } catch {}
    })();
    return originalSend(data);
  };
  next();
};

export const generateToken = (user) => jwt.sign(
  { id: user.id, staffId: user.staff_id, name: `${user.first_name} ${user.last_name}`,
    role: user.role, dept: user.dept_code, email: user.email },
  JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
);

export const generatePatientToken = (patient) => jwt.sign(
  { id: patient.id, patientId: patient.patient_id,
    name: `${patient.first_name} ${patient.last_name}`, role: 'patient', email: patient.email },
  JWT_SECRET,
  { expiresIn: '12h' }
);
