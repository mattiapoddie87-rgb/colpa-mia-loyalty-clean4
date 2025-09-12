// Invio email: Resend se disponibile, fallback SMTP. Log chiari.
const nodemailer = require('nodemailer');

const FORCE_SMTP = (process.env.FORCE_SMTP || '').toLowerCase() === 'true';

async function getResendClient() {
  if (FORCE_SMTP) return null;
  try {
    if (!process.env.RESEND_API_KEY) return null;
    // ESM-safe. Il modulo deve essere esternalizzato nel bundle (vedi netlify.toml).
    const mod = await import('resend');
    const Resend = mod.Resend || mod.default || mod;
    return new Resend(process.env.RESEND_API_KEY);
  } catch (e) {
    console.warn('Resend non disponibile:', e.message);
    return null;
  }
}

async function sendWithResend({ from, to, subject, html, text }) {
  const client = await getResendClient();
  if (!client) throw new Error('RESEND non configurato');
  const res = await client.emails.send({ from, to, subject, html, text });
  if (res?.error) throw new Error(res.error.message || 'Errore Resend');
  console.log('Resend OK', { id: res.id, to });
  return res;
}

async function sendWithSMTP({ from, to, subject, html, text }) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = (process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host) throw new Error('SMTP_HOST mancante');

  const transporter = nodemailer.createTransport({
    host, port, secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  const info = await transporter.sendMail({ from, to, subject, html, text });
  console.log('SMTP OK', { to, messageId: info.messageId });
  return info;
}

async function sendMail(opts) {
  try {
    const r = await sendWithResend(opts);
    return r;
  } catch (e) {
    console.warn('Resend fallito:', e.message);
  }
  return sendWithSMTP(opts);
}

module.exports = { sendMail };
