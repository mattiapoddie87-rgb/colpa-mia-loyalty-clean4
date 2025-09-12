// Invio email robusto: Resend via HTTPS nativo → fallback SMTP
const https = require('https');
const { URL } = require('url');
const nodemailer = require('nodemailer');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BCC_ADMIN = process.env.RESPONSABILITA_MAIL || '';
const FORCE_SMTP = (process.env.FORCE_SMTP || '').toLowerCase() === 'true';

function assertFrom(from) {
  if (!from || !from.includes('@')) throw new Error('MAIL_FROM non valido');
}

function httpsJson(method, url, headers, bodyObj) {
  const u = new URL(url);
  const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : Buffer.alloc(0);

  const opts = {
    method,
    hostname: u.hostname,
    port: 443,
    path: u.pathname + (u.search || ''),
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      ...headers,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (!ok) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    if (payload.length) req.write(payload);
    req.end();
  });
}

async function sendWithResend({ from, to, subject, html, text, replyTo }) {
  if (FORCE_SMTP) throw new Error('Forzato SMTP');
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY mancante');
  assertFrom(from);

  const body = { from, to, subject, html, text };
  if (replyTo) body.reply_to = replyTo;
  if (BCC_ADMIN) body.bcc = BCC_ADMIN;

  const res = await httpsJson(
    'POST',
    'https://api.resend.com/emails',
    { Authorization: `Bearer ${RESEND_API_KEY}` },
    body
  );
  console.log('Resend OK', { id: res.id, to });
  return res;
}

async function sendWithSMTP({ from, to, subject, html, text, replyTo }) {
  assertFrom(from);
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('SMTP_HOST mancante');

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = (process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const transporter = nodemailer.createTransport({
    host, port, secure, auth: user && pass ? { user, pass } : undefined,
  });

  const mail = { from, to, subject, html, text };
  if (replyTo) mail.replyTo = replyTo;
  if (BCC_ADMIN) mail.bcc = BCC_ADMIN;

  const info = await transporter.sendMail(mail);
  console.log('SMTP OK', { to, messageId: info.messageId });
  return info;
}

async function sendMail(opts) {
  try {
    return await sendWithResend(opts);
  } catch (e) {
    console.warn('Resend fallito:', e.message);
  }
  // Fallback solo se SMTP configurato
  if (process.env.SMTP_HOST) return sendWithSMTP(opts);
  throw new Error('Nessun canale email disponibile');
}

module.exports = { sendMail };
