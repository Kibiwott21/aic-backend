import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'aic_hms',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
});

pool.on('error', (err) => console.error('DB pool error:', err.message));
pool.on('connect', () => console.log('DB connected'));

export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[DB] ${text.slice(0,60)} — ${Date.now()-start}ms, ${res.rowCount} rows`);
    }
    return res;
  } catch (err) {
    console.error('[DB ERROR]', err.message, '|', text.slice(0,80));
    throw err;
  }
};

export const testConnection = async () => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connection verified');
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    return false;
  }
};
