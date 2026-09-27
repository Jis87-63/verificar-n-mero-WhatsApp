import { pool } from './client.js';

const statements = [
  `CREATE TABLE IF NOT EXISTS verification_jobs (id UUID PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed')), total INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS verification_results (id BIGSERIAL PRIMARY KEY, job_id UUID NOT NULL REFERENCES verification_jobs(id) ON DELETE CASCADE, input_number TEXT NOT NULL, normalized_number TEXT, exists_on_whatsapp BOOLEAN, error TEXT, checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(job_id, input_number))`,
  `CREATE TABLE IF NOT EXISTS whatsapp_sessions (id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), status TEXT NOT NULL DEFAULT 'initializing', qr_code TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `INSERT INTO whatsapp_sessions (id, status) VALUES (1, 'initializing') ON CONFLICT (id) DO NOTHING`
];
async function migrate() { for (const sql of statements) await pool.query(sql); await pool.end(); }
migrate().catch(async error => { console.error(error); await pool.end(); process.exit(1); });
