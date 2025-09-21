// netlify/functions/rs-choice.js
const https = require('https');
const nodemailer = require('nodemailer');
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const j = (code, obj) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

  try {
    const { token, choice } = JSON.parse(event.body || '{}');
    if (!token || !choice) return j(400, { error: 'bad_request' });

    // --- Blobs (inizializzazione esplicita: fix del tuo errore) -------------
    const store = getStore({
      name: 'rs',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });

    // Recupero record (supporta entrambe le chiavi: "id" o "links/<id>.json")
    let rec = await store.get(token, { type: 'json' });
    if (!rec) rec = await store.get(`links/${token}.json`, { type: 'json' });
    if (!rec) return j(400, { error: 'invalid_token' });

    // --- next action lato client -------------------------------------------
    let next_action = null;
    if (choice === 'reprogram') {
      const to = encodeURIComponent(rec.email || '');
      next_action = {
        type: 'open',
        url:
          `mailto:${to}` +
          `?subject=${encodeURIComponent('Riprogrammazione — ' + (rec.context || 'RS'))}` +
          `&body=${encodeURIComponent('Ciao, riprogrammiamo. (ID: ' + rec.id + ')')}`,
      };
    } else if (choice === 'callme') {
      const to = encodeURIComponent(rec.email || '');
      next_action = {
        type: 'open',
        url:
          `mailto:${to}` +
          `?subject=${encodeURIComponent('Richiamami — ' + (rec.context || 'RS'))}` +
          `&body=${encodeURIComponent('Mi puoi richiamare? (ID: ' + rec.id + ')')}`,
      };
    } else if (choice === 'voucher') {
      next_action = { type: 'redirect', url: '/#catalogo' };
    }

    // --- invio mail (Resend -> fallback SMTP) -------------------------------
    const toNotify = (process.env.EMAIL_TO || rec.email || '').trim();
    if (toNotify) {
      const subject = `[RS] Scelta: ${choice} — ${rec.context || 'RS'}`;
      const html = `
        <p><b>Scelta:</b> ${esc(choice)}</p>
        <p><b>Contesto:</b> ${esc(rec.context || '')}</p>
        <p><b>Note:</b> ${esc(rec.note || rec.brief || '')}</p>
        <p><b>ID:</b> <code>${esc(rec.id || token)}</code></p>
        <hr/><p>Timestamp: ${new Date().toISOString()}</p>
      `;

      let sent = false;

      // Resend
      if (process.env.RESEND_API_KEY && (process.env.RS_FROM_EMAIL || process.env.RESEND_FROM || process.env.FROM_EMAIL)) {
        try {
          await sendResend({
            apiKey: process.env.RESEND_API_KEY,
            from: process.env.RS_FROM_EMAIL || process.env.RESEND_FROM || process.env.FROM_EMAIL,
            to: toNotify,
            subject,
            html,
          });
          sent = true;
        } catch (_) { /* fallback SMTP */ }
      }

      // SMTP fallback
      if (!sent && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: String(process.env.SMTP_SECURE || 'false') === 'true',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        const from = process.env.EMAIL_FROM || `COLPA MIA <${process.env.SMTP_USER}>`;
        await transporter.sendMail({ from, to: toNotify, subject, html });
      }
    }

    // (opzionale) log scelta nello store
    try {
      const key = rec.id || token;
      await store.setJSON(`choices/${key}-${Date.now()}.json`, { id: key, choice, at: Date.now() });
    } catch { /* best-effort */ }

    return j(200, { ok: true, next_action });
  } catch (e) {
    return j(500, { error: 'server_error', detail: String(e && e.message || e) });
  }
};

// ---------------- utils -----------------------------------------------------
function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function sendResend({ apiKey, from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from, to, subject, html });
    const req = https.request({
      method: 'POST',
      hostname: 'api.resend.com',
      path: '/emails',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error('Resend ' + res.statusCode + ': ' + data)));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}
