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
const isProd = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CORS ────────────────────────────────────────────────────────
// Allows: Vercel frontend, localhost dev (any port), Render itself
const ALLOWED_ORIGINS = [
  process.env.PROD_FRONTEND_URL,           // https://aickapsowarhospital.vercel.app
  process.env.LOCAL_FRONTEND_URL,          // http://localhost:5000
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // In development allow all localhost origins
    if (!isProd && (origin.includes('localhost') || origin.includes('127.0.0.1'))) return callback(null, true);
    console.warn('[CORS] Blocked origin:', origin);
    callback(new Error('CORS: origin not allowed — ' + origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
}));

// Handle preflight for all routes
app.options('*', cors());

// ── BODY PARSING ────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── SECURITY HEADERS ────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Allow Vercel frontend to load resources
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  next();
});

// ── HEALTH CHECK (no auth) ──────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  env: process.env.NODE_ENV || 'development',
  time: new Date().toISOString(),
  db: isProd ? 'render' : 'local'
}));

app.get('/api/network-status', getNetworkStatus);

// ── STATIC (local dev only — Vercel serves frontend in prod) ────
if (!isProd) {
  const FRONTEND = path.join(__dirname, '../frontend/pages');
  app.use(express.static(FRONTEND));
  app.get('/', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));
}

// ── WIFI MIDDLEWARE (only for non-health routes) ────────────────
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/network-status') return next();
  wifiAccessControl(req, res, next);
});

// ── ALL API ROUTES ──────────────────────────────────────────────
app.use('/api', routes);

// ── 404 HANDLER ─────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── GLOBAL ERROR HANDLER ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);
  if (err.message?.includes('CORS')) return res.status(403).json({ error: err.message });
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── START ───────────────────────────────────────────────────────
testConnection().then(ok => {
  if (!ok && isProd) { console.error('DB connection failed — exiting'); process.exit(1); }
  verifyEmailConfig().then(emailOk => {
    if (!emailOk && isProd) { console.error('Email service failed — exiting'); process.exit(1); }
    app.listen(PORT, () => {
      console.log(`\n🚀 AIC Kapsowar HMS running on port ${PORT}`);
      console.log(`   Mode    : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   API     : http://localhost:${PORT}/api`);
      console.log(`   Health  : http://localhost:${PORT}/api/health`);
      if (!isProd) console.log(`   Frontend: http://localhost:${PORT}`);
    });
  });
});
