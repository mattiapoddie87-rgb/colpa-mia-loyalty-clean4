// Invio email: Resend se possibile, altrimenti SMTP. Debug verboso.
const nodemailer = require('nodemailer');

const FORCE_SMTP = (process.env.FORCE_SMTP || '').toLowerCase() === 'true';

// Lazy dynamic import per compat ESM su Netlify
async function getResendClient() {
  if (FORCE_SMTP) return null;
  try {
    if (!process.env.RESEND_API_KEY) return null;
    const mod = await import('resend'); // ESM safe
    const Resend = mod.Resend || mod.default || mod;
    return new Resend(process.env.RESEND_API_KEY);
  } catch (e) {
    console.warn('Resend client non disponibile:', e.message);
    return null;
  }
}

async function sendWithResend({ from, to, subject, html, text }) {
  const client = await getResendClient();
  if (!client) throw new Error('RESEND non configurato');
  const res = await client.emails.send({ from, to, subject, html, text });
  if (res?.error) throw new Error(res.error.message || 'Errore Resend');
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

  return transporter.sendMail({ from, to, subject, html, text });
}

async function sendMail(opts) {
  // Prova Resend → fallback SMTP
  try {
    const r = await sendWithResend(opts);
    console.log('Email inviata via Resend:', { to: opts.to });
    return r;
  } catch (e) {
    console.warn('Resend fallito:', e.message);
  }
  try {
    const s = await sendWithSMTP(opts);
    console.log('Email inviata via SMTP:', { to: opts.to });
    return s;
  } catch (e) {
    console.error('SMTP fallito:', e.message);
    throw e;
  }
}

module.exports = { sendMail };
