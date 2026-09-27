import type { Request, Response } from 'express';
import { pool } from '../db/client.js';
export async function getSession(req: Request, res: Response) {
  const { rows } = await pool.query('SELECT status, qr_code, updated_at FROM whatsapp_sessions WHERE id = 1');
  return res.json(rows[0] ?? { status: 'initializing', qr_code: null });
}
