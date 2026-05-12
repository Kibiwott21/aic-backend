import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
<<<<<<< HEAD
const { Pool } = pkg;
const isProd = process.env.NODE_ENV === 'production';
let poolConfig;
if (isProd) {
  const connStr = process.env.PROD_DB_INTERNAL_URL || process.env.PROD_DB_EXTERNAL_URL;
  if (!connStr) { console.error('PROD_DB_INTERNAL_URL not set'); process.exit(1); }
  poolConfig = { connectionString: connStr, ssl: { rejectUnauthorized: false }, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };
  console.log('Using RENDER PostgreSQL');
} else {
  poolConfig = { user: process.env.DB_USER||'postgres', password: process.env.DB_PASSWORD||'postgres', host: process.env.DB_HOST||'localhost', port: parseInt(process.env.DB_PORT)||5432, database: process.env.DB_NAME||'aic_hms', ssl: false, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 3000 };
  console.log(`Using LOCAL PostgreSQL -> ${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
}
export const pool = new Pool(poolConfig);
pool.on('error', (err) => console.error('[DB pool error]', err.message));
=======

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

>>>>>>> 82282e34a8288fccb7ed8f89834e7fa77ec9eba8
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
<<<<<<< HEAD
    if (process.env.LOG_LEVEL === 'debug') console.log(`[DB] ${text.slice(0,60)} ${Date.now()-start}ms rows:${res.rowCount}`);
=======
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[DB] ${text.slice(0,60)} — ${Date.now()-start}ms, ${res.rowCount} rows`);
    }
>>>>>>> 82282e34a8288fccb7ed8f89834e7fa77ec9eba8
    return res;
  } catch (err) {
    console.error('[DB ERROR]', err.message, '|', text.slice(0,80));
    throw err;
  }
};
<<<<<<< HEAD
export const testConnection = async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`✅ PostgreSQL connected (${isProd?'Render':'Local'})`);
=======

export const testConnection = async () => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connection verified');
>>>>>>> 82282e34a8288fccb7ed8f89834e7fa77ec9eba8
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    return false;
  }
};
