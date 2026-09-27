import { Worker } from 'bullmq';
import { pool } from '../db/client.js';
import { queueConnection, type VerificationJobData } from '../lib/queue.js';
import { WhatsAppService } from '../services/whatsapp.service.js';

const whatsapp = new WhatsAppService();
await whatsapp.initialize();
const worker = new Worker<VerificationJobData>('verification', async job => {
  const { jobId, numbers } = job.data;
  await pool.query("UPDATE verification_jobs SET status = 'processing', error = NULL WHERE id = $1", [jobId]);
  let processed = 0;
  for (const inputNumber of numbers) {
    try {
      const result = await whatsapp.numberExists(inputNumber);
      await pool.query(`INSERT INTO verification_results (job_id, input_number, normalized_number, exists_on_whatsapp) VALUES ($1, $2, $3, $4) ON CONFLICT (job_id, input_number) DO UPDATE SET normalized_number = EXCLUDED.normalized_number, exists_on_whatsapp = EXCLUDED.exists_on_whatsapp, error = NULL, checked_at = NOW()`, [jobId, inputNumber, result.normalizedNumber, result.exists]);
    } catch (error) {
      await pool.query(`INSERT INTO verification_results (job_id, input_number, error) VALUES ($1, $2, $3) ON CONFLICT (job_id, input_number) DO UPDATE SET error = EXCLUDED.error, checked_at = NOW()`, [jobId, inputNumber, error instanceof Error ? error.message : 'Verification failed']);
    }
    processed += 1;
    await pool.query('UPDATE verification_jobs SET processed = $2 WHERE id = $1', [jobId, processed]);
    await job.updateProgress(Math.round((processed / numbers.length) * 100));
  }
  await pool.query("UPDATE verification_jobs SET status = 'completed', completed_at = NOW() WHERE id = $1", [jobId]);
}, { connection: queueConnection, concurrency: 1 });
worker.on('failed', async (job, error) => { if (job) await pool.query("UPDATE verification_jobs SET status = 'failed', error = $2 WHERE id = $1", [job.data.jobId, error.message]); });
worker.on('error', error => console.error('Worker error:', error));
console.info('Verification worker started');
