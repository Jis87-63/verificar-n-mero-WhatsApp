import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (req.header('x-api-key') !== env.API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}
