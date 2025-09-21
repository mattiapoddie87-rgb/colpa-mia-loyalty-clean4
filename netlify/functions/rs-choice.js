// netlify/functions/rs-choice.js
const https = require('https');
const nodemailer = require('nodemailer');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { token, choice } = JSON.parse(event.body || '{}');
    if (!token || !choice) return { statusCode: 400, headers: CORS, body: 'bad_request' };

    const payload = decodeToken(token);
    if (!payload) return { statusCode: 400, headers: CORS, body: 'invalid_token' };

    // Azione suggerita al client (solo per reprogram/callme)
    let next = null;
    if (choice === 'reprogram') {
      next = {
        type: 'open',
        url:
          `mailto:${encodeURIComponent(payload.email || '')}` +
          `?subject=${encodeURIComponent('Riprogrammazione — ' + (payload.context || 'RS'))}` +
          `&body=${encodeURIComponent('Ciao, riprogrammiamo. Token: ' + token)}`
      };
    } else if (choice === 'callme') {
      next = {
        type: 'open',
        url:
          `mailto:${encodeURIComponent(payload.email || '')}` +
          `?subject=${encodeURIComponent('Richiamami — ' + (payload.context || 'RS'))}` +
          `&body=${encodeURIComponent('Mi puoi richiamare? Token: ' + token)}`
      };
    }
    // NOTA: per "voucher" non impostiamo alcun redirect: resta sulla pagina.

    // ------- EMAIL NOTIFICA (Resend -> fallback SMTP) -------
    const to = (process.env.EMAIL_TO || payload.email || '').trim();
    if (to) {
      const subject = `[RS] Scelta: ${choice} — ${payload.context || 'RS'}`;
      const html = `
        <p><b>Scelta registrata:</b> ${escapeHtml(choice)}</p>
        <p><b>Contesto:</b> ${escapeHtml(payload.context || '')}</p>
        <p><b>Note:</b> ${escapeHtml(payload.note || '')}</p>
        <p><b>Token:</b> <code>${escapeHtml(token)}</code></p>
        <hr/>
        <p>Scelta effettuata alle: ${new Date().toISOString()}</p>
      `;

      // 1) Resend
      let sent = false;
      if (process.env.RESEND_API_KEY) {
        const from = process.env.EMAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';
        try {
          await sendResend({ apiKey: process.env.RESEND_API_KEY, from, to, subject, html });
          sent = true;
        } catch (e) { /* fallback sotto */ }
      }

      // 2) SMTP fallback
      if (!sent && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: String(process.env.SMTP_SECURE || 'false') === 'true',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        const from = process.env.EMAIL_FROM || `COLPA MIA <${process.env.SMTP_USER}>`;
        await transporter.sendMail({ from, to, subject, html });
      }
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, choice, next_action: next })
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: 'server_error: ' + (e.message || e) };
  }
};

function decodeToken(tok) {
  try {
    const b64 = tok.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]
  ));
}

function sendResend({ apiKey, from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from, to, subject, html });
    const req = https.request({
      method: 'POST',
      hostname: 'api.resend.com',
      path: '/emails',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data=''; res.on('data', c => data+=c);
      res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error('Resend ' + res.statusCode + ': ' + data)));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}
