// netlify/functions/session-email.js
// Prende i modelli da ai-excuse.js e li varia leggermente con GPT-4o.
// Se l’AI fallisce, invia il template puro.

const https = require('https');
const { sendMail } = require('./send-utils');
const aiExcuse = require('./ai-excuse.js'); // <-- file già presente

const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <noreply@colpamia.com>';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL_ || 'gpt-4o-mini';

// -------------------- session utils --------------------
function getNeed(session) {
  if (session?.metadata?.need) return String(session.metadata.need).trim();
  const cf = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  const f = cf.find(x => x?.key === 'need' && x?.type === 'text' && x?.text?.value);
  if (f?.text?.value) return String(f.text.value).trim();
  return (session?.client_reference_id || session?.metadata?.sku || 'SCUSA_BASE').toString().trim();
}
function getSKU(session) {
  return (session?.metadata?.sku || session?.client_reference_id || 'SCUSA_BASE')
    .toString().trim().toUpperCase();
}
function ctxLabel(s = '', sku = 'SCUSA_BASE') {
  const t = String(s).toLowerCase();
  if (/aper|spritz|drink/.test(t)) return 'APERITIVO';
  if (/cena|ristor/.test(t)) return 'CENA';
  if (/evento|party|festa|concerto/.test(t)) return 'EVENTO';
  if (/lavor|ufficio|meeting|report/.test(t)) return 'LAVORO';
  if (/calcett|partita|calcetto/.test(t)) return 'CALCETTO';
  if (/famigl|figli|marit|mogli|genit|madre|padre|nonna|nonno/.test(t)) return 'FAMIGLIA';
  if (/salute|febbre|medic|dott|tosse|allerg/.test(t)) return 'SALUTE';
  if (/appunt|conseg/.test(t)) return 'APPUNTAMENTO';
  if (/esame|lezion|prof/.test(t)) return 'ESAME';
  return sku;
}

// -------------------- http helper --------------------
function httpsJson(method, url, headers, body) {
  const u = new URL(url);
  const payload = Buffer.from(JSON.stringify(body || {}));
  const opts = {
    method,
    hostname: u.hostname,
    port: 443,
    path: u.pathname + (u.search || ''),
    headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers },
    timeout: 15000
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
    req.write(payload);
    req.end();
  });
}

// -------------------- variazione leggera --------------------
async function varyLight(text) {
  if (!OPENAI_API_KEY) return text;
  const system = 'Parafrasa leggermente in italiano. Mantieni significato e tono. 1-3 frasi. Niente emoji o saluti. Restituisci solo il testo.';
  const user = `Testo base:\n"""${text}"""`;
  try {
    const r = await httpsJson(
      'POST',
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${OPENAI_API_KEY}` },
      { model: OPENAI_MODEL, temperature: 0.3, max_tokens: 160, messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ] }
    );
    return r?.choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

// -------------------- modelli da ai-excuse --------------------
async function getTemplates({ sku, need }) {
  const event = { httpMethod: 'POST', body: JSON.stringify({ sku, need }) };
  const res = await aiExcuse.handler(event);
  if (!res || res.statusCode !== 200) throw new Error('ai_excuse_error');
  const payload = JSON.parse(res.body || '{}');
  const arr = Array.isArray(payload.variants) ? payload.variants : [];
  const texts = arr.map(v => v && (v.text || v.whatsapp_text)).filter(Boolean);
  if (!texts.length) throw new Error('ai_excuse_empty');
  return texts;
}

// -------------------- render --------------------
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function renderHtml({ ctx, variants }) {
  const items = variants.map(t => `<div style="margin:12px 0;white-space:pre-wrap">${escapeHtml(t)}</div>`).join('');
  return `<!doctype html><html lang="it"><meta charset="utf-8"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;margin:0;padding:24px;background:#fafafa">
  <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">
    <h1 style="font-size:20px;margin:0 0 12px">La tua scusa è pronta</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#555">Contesto: <strong>${escapeHtml(ctx)}</strong></p>
    ${items}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="font-size:12px;color:#777">Per modifiche, rispondi a questa email con le istruzioni.</p>
  </div></body></html>`;
}
function renderText({ ctx, variants }) {
  return `La tua scusa è pronta\nContesto: ${ctx}\n\n${variants.join('\n\n')}\n`;
}

// -------------------- entry usata dal webhook --------------------
async function sendCheckoutEmail({ session, lineItems, overrideTo, replyTo }) {
  const to = overrideTo || session?.customer_details?.email || session?.customer_email;
  if (!to) throw new Error('destinatario mancante');

  const need = getNeed(session);
  const sku  = getSKU(session);
  const ctx  = ctxLabel(need, sku);

  // 1) prendi i modelli fissi
  const base = await getTemplates({ sku, need });

  // 2) variazione leggera
  const variants = [];
  for (const t of base) variants.push(await varyLight(t));

  const subject = `La tua scusa • ${ctx}`;
  const html = renderHtml({ ctx, variants });
  const text = renderText({ ctx, variants });

  await sendMail({ from: MAIL_FROM, to, subject, html, text, replyTo });
  return { to, subject };
}

module.exports = { sendCheckoutEmail };
