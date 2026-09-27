import type { Request, Response } from 'express';

export default function health(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', service: 'whatsapp-number-verifier', runtime: 'vercel' });
}
