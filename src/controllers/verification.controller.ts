import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { verificationQueue } from '../lib/queue.js';
import { env } from '../config/env.js';

const batchSchema = z.object({ numbers: z.array(z.string().trim().min(1)).min(1).max(env.MAX_BATCH_SIZE) });
export async function enqueueBatch(req: Request, res: Response) {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  const numbers = [...new Set(parsed.data.numbers)];
  const jobId = randomUUID();
  await pool.query('INSERT INTO verification_jobs (id, status, total) VALUES ($1, $2, $3)', [jobId, 'pending', numbers.length]);
  try { await verificationQueue.add('verify-batch', { jobId, numbers }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 }); }
  catch (error) { await pool.query("UPDATE verification_jobs SET status = 'failed', error = $2 WHERE id = $1", [jobId, error instanceof Error ? error.message : 'Queue submission failed']); throw error; }
  return res.status(202).json({ jobId, status: 'pending', total: numbers.length });
}
export async function getStatus(req: Request, res: Response) {
  const { rows } = await pool.query('SELECT id, status, total, processed, error, created_at, completed_at FROM verification_jobs WHERE id = $1', [req.params.jobId]);
  if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
  const job = rows[0];
  return res.json({ ...job, progress: job.total === 0 ? 0 : Math.round((job.processed / job.total) * 100) });
}
export async function getResults(req: Request, res: Response) {
  const { rows: jobs } = await pool.query('SELECT status, total, processed FROM verification_jobs WHERE id = $1', [req.params.jobId]);
  if (!jobs[0]) return res.status(404).json({ error: 'Job not found' });
  const { rows: results } = await pool.query('SELECT input_number, normalized_number, exists_on_whatsapp, error, checked_at FROM verification_results WHERE job_id = $1 ORDER BY id', [req.params.jobId]);
  return res.json({ jobId: req.params.jobId, ...jobs[0], results });
}
