import QRCode from 'qrcode';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';

type SessionStatus = 'initializing' | 'qr_ready' | 'authenticated' | 'ready' | 'disconnected' | 'auth_failure';

export class WhatsAppService {
  private readonly client = new Client({
    authStrategy: new LocalAuth({ dataPath: env.WHATSAPP_AUTH_PATH }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
  });
  private ready = false;

  async initialize(): Promise<void> {
    this.client.on('qr', async qr => this.setStatus('qr_ready', await QRCode.toDataURL(qr)));
    this.client.on('authenticated', async () => this.setStatus('authenticated'));
    this.client.on('ready', async () => { this.ready = true; await this.setStatus('ready'); });
    this.client.on('auth_failure', async () => this.setStatus('auth_failure'));
    this.client.on('disconnected', async () => { this.ready = false; await this.setStatus('disconnected'); });
    await this.setStatus('initializing');
    await this.client.initialize();
  }

  async numberExists(input: string): Promise<{ normalizedNumber: string; exists: boolean }> {
    if (!this.ready) throw new Error('WhatsApp client is not ready. Scan the QR code and wait for ready status.');
    const normalizedNumber = input.replace(/\D/g, '');
    if (normalizedNumber.length < 8 || normalizedNumber.length > 15) throw new Error('Invalid E.164-compatible phone number');
    const contact = await this.client.getNumberId(`${normalizedNumber}@c.us`);
    return { normalizedNumber, exists: contact !== null };
  }

  private async setStatus(status: SessionStatus, qrCode: string | null = null): Promise<void> {
    await pool.query(`INSERT INTO whatsapp_sessions (id, status, qr_code, updated_at) VALUES (1, $1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, qr_code = EXCLUDED.qr_code, updated_at = NOW()`, [status, qrCode]);
  }
}
