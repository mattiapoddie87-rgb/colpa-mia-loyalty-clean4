// Registra la scelta (stateless): decodifica il token base64url e, se vuoi,
// invia una mail di notifica usando RESEND (opzionale). Nessun Blob.

const https = require('https');

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { token, choice } = JSON.parse(event.body || '{}');
    if (!token || !choice) return { statusCode: 400, headers: CORS, body: 'bad_request' };

    const payload = decodeToken(token);
    if (!payload) return { statusCode: 400, headers: CORS, body: 'invalid_token' };

    // Azione coerente (mailto/redirect) rimandata al client via next_action
    let next = null;
    if (choice === 'reprogram') {
      next = {
        type: 'open',
        url: `mailto:${encodeURIComponent(payload.email || '')}` +
             `?subject=${encodeURIComponent('Riprogrammazione — ' + (payload.context || 'RS'))}` +
             `&body=${encodeURIComponent('Ciao, riprogrammiamo. Token: ' + token)}`
      };
    } else if (choice === 'callme') {
      next = {
        type: 'open',
        url: `mailto:${encodeURIComponent(payload.email || '')}` +
             `?subject=${encodeURIComponent('Richiamami — ' + (payload.context || 'RS'))}` +
             `&body=${encodeURIComponent('Mi puoi richiamare? Token: ' + token)}`
      };
    } else if (choice === 'voucher') {
      next = { type: 'redirect', url: '/#catalogo' };
    }

    // (OPZIONALE) notifica via Resend se hai la chiave: RESEND_API_KEY
    if (process.env.RESEND_API_KEY && (process.env.EMAIL_TO || payload.email)) {
      const to = process.env.EMAIL_TO || payload.email;
      await sendResend({
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.EMAIL_FROM || 'noreply@colpamia.com',
        to,
        subject: `[RS] Scelta: ${choice} — ${payload.context || 'RS'}`,
        html: `<p>Scelta registrata: <b>${choice}</b></p>
               <p>Contesto: <b>${escapeHtml(payload.context || '')}</b></p>
               <p>Note: ${escapeHtml(payload.note || '')}</p>
               <p>Token: <code>${token}</code></p>`
      });
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

// Invio email minimale via Resend REST
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
