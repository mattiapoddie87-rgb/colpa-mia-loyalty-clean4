// Invio email robusto: HTTP Resend diretto → fallback SMTP
const nodemailer = require('nodemailer');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FORCE_SMTP = (process.env.FORCE_SMTP || '').toLowerCase() === 'true';

async function sendWithResendHTTP({ from, to, subject, html, text }) {
  if (FORCE_SMTP) throw new Error('Forzato SMTP');
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY mancante');

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Resend ${resp.status}: ${body}`);
  }

  const data = await resp.json(); // { id: "..." }
  console.log('Resend OK', { id: data.id, to });
  return data;
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
    return await sendWithResendHTTP(opts);
  } catch (e) {
    console.warn('Resend fallito:', e.message);
  }
  return sendWithSMTP(opts);
}

module.exports = { sendMail };
