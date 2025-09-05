// netlify/functions/lead-pdf.js
const { Resend } = require('resend');

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/, '');
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return j(400, { error: 'bad_json' }); }

  // Honeypot anti-bot: se valorizzato, fingi successo e stop
  if (body.hp) return j(200, { ok: true, skipped: true });

  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();

  // Costruisci URL assoluto del PDF
  const pdfReq = String(body.pdf || '/assets/lead.pdf');
  const pdfUrl = /^https?:\/\//i.test(pdfReq)
    ? pdfReq
    : `${ORIGIN}${pdfReq.startsWith('/') ? pdfReq : '/' + pdfReq}`;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return j(400, { error: 'invalid_email' });

  let emailSent = false;
  let reason = null;

  // Invio email (best-effort): non fallire la request se Resend non è configurato
  const key = (process.env.RESEND_API_KEY || '').trim(); // Resend: "re_..."
  const fromCfg = process.env.RESEND_FROM || process.env.MAIL_FROM || '';
  const from = /@/.test(fromCfg) ? fromCfg : 'COLPA MIA <onboarding@resend.dev>';

  if (key) {
    const resend = new Resend(key);
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
        <h2 style="margin:0 0 12px">Il tuo PDF: 7 scuse che non funzionano più</h2>
        <p>Scaricalo da qui: <a href="${pdfUrl}">${pdfUrl}</a></p>
        ${phone ? `<p style="font-size:13px;color:#555">Telefono indicato: ${phone}</p>` : ''}
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p style="font-size:13px;color:#555">Se non riconosci la richiesta, ignora questa email.</p>
      </div>
    `;
    try {
      await resend.emails.send({ from, to: email, subject: 'Il tuo PDF — Colpa Mia', html });
      emailSent = true;
    } catch (err) {
      console.error('resend_error', err?.message || err);
      reason = String(err?.message || 'send_error');
      // non rilanciare: la risposta deve restare 200
    }
  } else {
    reason = 'no_resend_key';
  }

  // Sempre 200: il download nel client parte comunque
  return j(200, { ok: true, emailSent, reason, pdf: pdfUrl });
};
