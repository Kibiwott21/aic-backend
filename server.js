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
const app  = express();
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

// WiFi access control
app.use(wifiAccessControl);

// Health/status route (always open)
app.get("/api/health", getNetworkStatus);

// Protected routes
app.post("/api/auth/staff/login", staffLoginHandler);

// API routes
app.use('/api', routes);
app.get('/api/network-status', getNetworkStatus);

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

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

async function start() {
  console.log('\n\x1b[34m🏥 AIC Kapsowar Hospital HMS v9.0\x1b[0m');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await testConnection();
  await verifyEmailConfig();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Running: http://localhost:${PORT}`);
    console.log(`🌐 Frontend: http://localhost:${PORT}/`);
    console.log('📶 WiFi: AIC-Staff-Secure | AIC-Clinical | AIC-Patients');
    console.log('👤 Admins: ADM0001 | SEC0001 | HR0001\n');
  });
}
start();
