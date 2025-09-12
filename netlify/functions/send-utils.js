// Invio email con fallback: Resend -> SMTP (Nodemailer)
let resendClient = null;
try {
  const { Resend } = require('@resend/node');
  if (process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
} catch {}

const nodemailer = require('nodemailer');

async function sendWithResend({ from, to, subject, html, text }) {
  if (!resendClient) throw new Error('RESEND non configurato');
  const res = await resendClient.emails.send({ from, to, subject, html, text });
  if (res.error) throw new Error(res.error.message || 'Errore Resend');
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
  return info;
}

async function sendMail(opts) {
  try {
    if (resendClient) return await sendWithResend(opts);
  } catch (e) {
    console.warn('Resend fallito, passo a SMTP:', e.message);
  }
  return await sendWithSMTP(opts);
}

module.exports = { sendMail };
