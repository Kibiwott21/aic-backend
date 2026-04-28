// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { testConnection } from './config/database.js';
import { verifyEmailConfig } from './services/emailService.js';
import { wifiAccessControl, getNetworkStatus } from './middleware/wifiControl.js';
import routes from './routes/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Frontend pages directory — served at root
const FRONTEND = path.join(__dirname, '../frontend/pages');

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  next();
});

/*
  Load optional controllers safely.
  If ./controllers/authController.js exists and exports staffLoginHandler,
  we'll use it. Otherwise we provide a minimal placeholder so the server starts.
*/
let staffLoginHandler;
try {
  // top-level await is supported in ESM (Node >= 14+ with "type":"module")
  const authModule = await import('./controllers/authController.js');
  staffLoginHandler = authModule.staffLoginHandler;
  if (typeof staffLoginHandler !== 'function') {
    console.warn('[server] staffLoginHandler not exported as function — using fallback.');
    staffLoginHandler = undefined;
  }
} catch (err) {
  console.warn('[server] controllers/authController.js not found or failed to import — using temporary fallback handler.');
  staffLoginHandler = undefined;
}

// Fallback minimal handler (temporary). Replace with real auth logic in controllers/authController.js
if (!staffLoginHandler) {
  staffLoginHandler = async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Missing credentials (temporary handler)' });
      }
      // NOTE: This is a placeholder. Replace with real DB lookup and password verification.
      return res.json({ ok: true, message: 'Temporary staff login accepted (replace with real auth)', user: { username } });
    } catch (err) {
      console.error('[staffLoginHandler fallback] error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// Health/status route (always open) — register before wifiAccessControl to be explicit
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Network status endpoint (always open)
app.get('/api/network-status', getNetworkStatus);

// Apply WiFi access control middleware for protected routes
app.use(wifiAccessControl);

// Protected routes (example)
app.post('/api/auth/staff/login', staffLoginHandler);

// API routes (other routes)
app.use('/api', routes);

// Favicon
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(FRONTEND, 'favicon.ico')));
app.get('/favicon.png', (req, res) => res.sendFile(path.join(FRONTEND, 'favicon.png')));

// Serve frontend static files (HTML, CSS, JS, images)
app.use(express.static(FRONTEND));

// Clean URL routing — /verify-email → /verify-email.html etc.
const HTML_PAGES = [
  'index','login','register','verify-email','forgot-password','reset-password',
  'admin-dashboard','staff-portal','patient-login','patient-dashboard',
  'receptionist-dashboard','triage-dashboard','doctor-dashboard',
  'pharmacy-dashboard','lab-dashboard','finance-dashboard',
  'leave-requests','leave-admin','patients','new-patient','patient-journey',
  'appointments','my-reports','admin-reports','attendance-admin',
  'audit-logs','brute-force-monitor','intrusion-monitor','security-alerts',
  'network','staff','no-wifi','notifications'
];

HTML_PAGES.forEach(function(page) {
  // Handle both /page and /page.html
  app.get('/' + page, (req, res) => {
    res.sendFile(path.join(FRONTEND, page + '.html'));
  });
  app.get('/' + page + '.html', (req, res) => {
    res.sendFile(path.join(FRONTEND, page + '.html'));
  });
});

// Root → index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// 404 for unknown routes
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Route not found' });
  } else {
    res.status(404).sendFile(path.join(FRONTEND, 'index.html'));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

async function start() {
  console.log('\n\x1b[34m🏥 AIC Kapsowar Hospital HMS v9.0\x1b[0m');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    await testConnection();
  } catch (err) {
    console.error('Database connection failed:', err?.message || err);
    // Decide whether to exit or continue; here we continue so dev can still test UI.
  }

  try {
    await verifyEmailConfig();
  } catch (err) {
    console.warn('Email config verification failed:', err?.message || err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Running: http://localhost:${PORT}`);
    console.log(`🌐 Frontend: http://localhost:${PORT}/`);
    console.log('📶 WiFi: AIC-Staff-Secure | AIC-Clinical | AIC-Patients');
    console.log('👤 Admins: ADM0001 | SEC0001 | HR0001\n');
  });
}

start();
