import express from 'express';
import { helmet } from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import api from './routes/api.js';
import { requireApiKey } from './middleware/api-key.js';

export const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'whatsapp-number-verifier' }));
app.use('/api/v1', requireApiKey, api);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});
