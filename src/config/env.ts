import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_KEY: z.string().min(16),
  WHATSAPP_AUTH_PATH: z.string().default('.wwebjs_auth'),
  MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(500)
});
export const env = schema.parse(process.env);
