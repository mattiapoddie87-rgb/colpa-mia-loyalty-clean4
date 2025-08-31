// netlify/functions/send-utils.js
// Email via Resend. ENV richieste: RESEND_API_KEY, MAIL_FROM (opzionale).

const API = 'https://api.resend.com/emails';

const KEY  = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'onboarding@resend.dev'; // ok per test; per produzione usa dominio verificato

async function sendEmail(to, subject, html) {
  if (!KEY) return { sent: false, reason: 'RESEND_API_KEY missing' };
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html })
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out?.message || 'Resend error');
  return { sent: true, id: out.id || null };
}

module.exports = { sendEmail };

