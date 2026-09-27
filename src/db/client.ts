import { Pool } from 'pg';
import { env } from '../config/env.js';
export const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
