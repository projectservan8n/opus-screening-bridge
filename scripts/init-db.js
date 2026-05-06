// One-shot schema initializer. Idempotent.
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app') || process.env.DATABASE_URL?.includes('rlwy.net')
    ? { rejectUnauthorized: false }
    : false,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidates (
  candidate_id TEXT PRIMARY KEY,
  role_slug TEXT NOT NULL,
  candidate_name TEXT,
  candidate_email TEXT,
  candidate_location TEXT,
  resume_url TEXT,
  portfolio_url TEXT,
  current_phase TEXT DEFAULT 'warm_up',
  status TEXT NOT NULL DEFAULT 'in_progress',
  verdict TEXT,
  score NUMERIC,
  summary TEXT,
  strongest_signal TEXT,
  top_concern TEXT,
  internal_state JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  phase TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_candidate ON messages(candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_candidates_role_status ON candidates(role_slug, status);
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set, skipping schema init');
    process.exit(0);
  }
  try {
    await pool.query(SCHEMA);
    console.log('✓ DB schema ensured');
  } catch (e) {
    console.error('✗ Schema init failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
