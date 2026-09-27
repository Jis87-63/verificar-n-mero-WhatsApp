import { Queue } from 'bullmq';
import { env } from '../config/env.js';

const redis = new URL(env.REDIS_URL);
export const queueConnection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: redis.username || undefined,
  password: redis.password || undefined,
  tls: redis.protocol === 'rediss:' ? {} : undefined,
  maxRetriesPerRequest: null
};
export interface VerificationJobData { jobId: string; numbers: string[] }
export const verificationQueue = new Queue<VerificationJobData>('verification', { connection: queueConnection });
