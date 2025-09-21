// netlify/functions/rs-choice.js
const https = require('https');
const nodemailer = require('nodemailer');
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const ok  = (b)=>({ statusCode:200, headers:{...CORS,'Content-Type':'application/json'}, body:JSON.stringify(b) });
const bad = (s,m)=>({ statusCode:s, headers:{...CORS,'Content-Type':'application/json'}, body:typeof m==='string'?m:JSON.stringify(m) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS };
  if (event.httpMethod !== 'POST')     return bad(405,'Method Not Allowed');

  try{
    const { token, id, choice } = JSON.parse(event.body || '{}');
    const key = token || id;
    if (!key || !choice) return bad(400, 'bad_request');

    // 1) Prova a decodificare (vecchio token base64-url)
    let payload = decodeTokenSoft(key);

    // 2) Se non è un token decodificabile, è un UUID: recupera dai Blobs (nuovo flusso)
    if (!payload){
      const store = getStore('rs', {
        siteID: process.env.NETLIFY_SITE_ID,
        token:  process.env.NETLIFY_BLOBS_TOKEN
      });

      // prova chiave piatta e poi "links/<id>.json"
      payload = await store.getJSON(key).catch(()=>null);
      if (!payload) payload = await store.get(`links/${key}.json`, { type:'json' }).catch(()=>null);
      if (!payload) return bad(400, 'invalid_token'); // id non trovato
    }

    // Dati utili
    const email   = String(process.env.EMAIL_TO || payload.email || '').trim();
    const context = payload.context || payload.ctx || 'RS';
    const note    = payload.note || payload.brief || '';

    // Azione suggerita al client
    let next = null;
    if (choice === 'reprogram'){
      next = { type:'open',
        url:`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Riprogrammazione — '+context)}&body=${encodeURIComponent('Ciao, riprogrammiamo.')}`
      };
    } else if (choice === 'callme'){
      next = { type:'open',
        url:`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Richiamami — '+context)}&body=${encodeURIComponent('Mi puoi richiamare?')}`
      };
    } else if (choice === 'voucher'){
      next = { type:'redirect', url:'/#catalogo' };
    }

    // --- EMAIL di notifica ---
    if (email){
      const subject = `[RS] Scelta: ${choice} — ${context}`;
      const html = `
        <p><b>Scelta registrata:</b> ${escapeHtml(choice)}</p>
        <p><b>Contesto:</b> ${escapeHtml(context)}</p>
        ${note ? `<p><b>Note:</b> ${escapeHtml(note)}</p>` : ''}
        <hr/><p>${new Date().toISOString()}</p>
      `;
      await sendEmail({ subject, html, to: email });
    }

    return ok({ ok:true, choice, next_action: next });
  }catch(e){
    return bad(500, 'server_error: '+(e.message||e));
  }
};

function decodeTokenSoft(tok){
  try{
    const b64 = String(tok).replace(/-/g,'+').replace(/_/g,'/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    return JSON.parse(json);
  }catch{ return null; }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function sendEmail({ to, subject, html }){
  // 1) Resend
  if (process.env.RESEND_API_KEY){
    const from = process.env.EMAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';
    await sendResend({ apiKey: process.env.RESEND_API_KEY, from, to, subject, html });
    return;
  }
  // 2) SMTP fallback
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS){
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

function sendResend({ apiKey, from, to, subject, html }){
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from, to, subject, html });
    const req = https.request({
      method:'POST', hostname:'api.resend.com', path:'/emails',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, res => {
      let data=''; res.on('data', c => data+=c);
      res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error('Resend '+res.statusCode+': '+data)));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
