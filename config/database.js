import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
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
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.LOG_LEVEL === 'debug') console.log(`[DB] ${text.slice(0,60)} ${Date.now()-start}ms rows:${res.rowCount}`);
    return res;
  } catch (err) {
    console.error('[DB ERROR]', err.message, '|', text.slice(0,80));
    throw err;
  }
};
export const testConnection = async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`✅ PostgreSQL connected (${isProd?'Render':'Local'})`);
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    return false;
  }
};
