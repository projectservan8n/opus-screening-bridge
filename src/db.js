import pg from 'pg';

const { Pool } = pg;
const isManaged =
  process.env.DATABASE_URL?.includes('railway.app') ||
  process.env.DATABASE_URL?.includes('rlwy.net') ||
  process.env.DATABASE_URL?.includes('proxy.rlwy.net');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isManaged ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err);
});

export const q = (text, params) => pool.query(text, params);
