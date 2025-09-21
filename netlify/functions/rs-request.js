// rs-request.js — genera il link RS e invia la mail (Resend -> fallback SMTP)

const https = require('https');
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    const userEmail = (body.email || '').trim();
    const context   = body.context || '';
    const note      = body.note || '';
    const proof     = body.proof || 'Si'; // info opzionale
    const ttlDays   = Number(body.ttlDays || 0) || 0;

    if (!userEmail) return { statusCode: 400, headers: CORS, body: 'bad_request: email mancante' };

    // ----- token base64url con i dati essenziali -----
    const payload = {
      email: userEmail,
      context,
      note,
      proof,
      iat: Date.now(),
      exp: ttlDays > 0 ? Date.now() + ttlDays*24*60*60*1000 : null
    };
    const token = toB64Url(JSON.stringify(payload));
    const base = process.env.PUBLIC_BASE_URL
      || `https://${event.headers['x-forwarded-host'] || event.headers.host}`;
    const url  = `${base}/rs/${token}`;

    // (facoltativo) salvataggio best-effort su Netlify Blobs
    try {
      if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
        const { createClient } = await import('@netlify/blobs');
        const client = createClient({ siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
        await client.set(`rs:${token}`, { body: JSON.stringify({ ...payload, url }), contentType: 'application/json' });
      }
    } catch (e) {
      // non bloccare la generazione del link se Blobs non è configurato
      console.log('blobs_skip', e.message);
    }

    // ----- invio email -----
    const to = (process.env.EMAIL_TO || userEmail);
    const subject = `Responsibility Switch — il tuo link`;
    const html = `
      <p>Ciao,</p>
      <p>ecco il tuo link personale per il Responsibility Switch:</p>
      <p><a href="${url}">${url}</a></p>
      <hr/>
      <p><b>Contesto:</b> ${esc(context)}<br/>
         <b>Note:</b> ${esc(note)}<br/>
         <b>Prova di consegna:</b> ${esc(proof)}</p>
      <p style="font-size:12px;color:#666">Token: <code>${esc(token)}</code></p>
    `;

    let sent = false;
    if (process.env.RESEND_API_KEY) {
      const from = process.env.EMAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';
      try {
        await sendResend({ apiKey: process.env.RESEND_API_KEY, from, to, subject, html });
        sent = true;
      } catch (e) {
        console.log('resend_fail', e.message);
      }
    }
    if (!sent && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false') === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      const from = process.env.EMAIL_FROM || `COLPA MIA <${process.env.SMTP_USER}>`;
      await transporter.sendMail({ from, to, subject, html });
      sent = true;
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, url, email_sent: sent })
    };
  } catch (e) {
    console.error('rs-request error:', e);
    return { statusCode: 500, headers: CORS, body: 'server_error: ' + (e.message || e) };
  }
};

// -------- helpers --------
function toB64Url(s) {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function esc(s){ return String(s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
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
