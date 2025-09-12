// netlify/functions/session-email.js
// Genera la "scusa" e invia l'email post-checkout.
const https = require('https');
const { sendMail } = require('./send-utils');

const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <noreply@colpamia.com>';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL_ || 'gpt-4o-mini';

// ---- UTIL ----
function getNeed(session) {
  // 1) metadata dal menu
  if (session?.metadata?.need) return String(session.metadata.need).trim();
  // 2) custom_fields di Checkout (se presente)
  const cf = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  const found = cf.find(f => f?.key === 'need' && f?.type === 'text' && f?.text?.value);
  if (found?.text?.value) return String(found.text.value).trim();
  // 3) fallback da SKU
  return (session?.client_reference_id || session?.metadata?.sku || 'SCUSA_BASE').toString().trim();
}

function getSKU(session) {
  return (session?.metadata?.sku || session?.client_reference_id || 'SCUSA_BASE').toString().trim().toUpperCase();
}

function httpsJson(method, url, headers, bodyObj) {
  const u = new URL(url);
  const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : Buffer.alloc(0);
  const opts = {
    method,
    hostname: u.hostname,
    port: 443,
    path: u.pathname + (u.search || ''),
    headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers },
    timeout: 20000,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
    if (payload.length) req.write(payload);
    req.end();
  });
}

// ---- AI "SCUSA" ----
async function generateExcuse({ need, sku }) {
  // Fallback rapido se manca OpenAI
  const fallback = `Oggetto: ${need}\n\nMi dispiace. Ho avuto un imprevisto e non sono riuscito a rispettare l’impegno. \
Rimedio subito con una nuova proposta e mi prendo carico di organizzare tutto perché non si ripeta.`;

  if (!OPENAI_API_KEY) return fallback;

  const system = "Scrivi una scusa breve, credibile e responsabilizzante in italiano. Tono sobrio e professionale. 80-120 parole. Niente emoji.";
  const user = `Contesto: ${need}. Prodotto: ${sku}. Genera solo il testo della scusa, senza saluti iniziali/finali aggiuntivi.`;

  try {
    const res = await httpsJson(
      'POST',
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${OPENAI_API_KEY}` },
      {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_tokens: 220,
      }
    );
    const txt = res?.choices?.[0]?.message?.content?.trim();
    return txt || fallback;
  } catch (e) {
    console.warn('AI fallback per errore:', e.message);
    return fallback;
  }
}

// ---- EMAIL ----
function renderHtml({ excuse, need }) {
  return `<!doctype html>
<html lang="it"><meta charset="utf-8">
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;margin:0;padding:24px;background:#fafafa">
  <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">
    <h1 style="font-size:20px;margin:0 0 12px">La tua scusa è pronta</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#555">Contesto: <strong>${escapeHtml(need)}</strong></p>
    <div style="white-space:pre-wrap;font-size:16px;margin:12px 0 16px">${escapeHtml(excuse)}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="font-size:12px;color:#777">Se vuoi modificarla rispondi a questa email indicando correzioni o vincoli. </p>
  </div>
</body></html>`;
}
function renderText({ excuse, need }) {
  return `La tua scusa è pronta\nContesto: ${need}\n\n${excuse}\n\n`;
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// API pubblica usata dal webhook
async function sendCheckoutEmail({ session, lineItems, overrideTo, replyTo }) {
  const to =
    overrideTo ||
    session?.customer_details?.email ||
    session?.customer_email;

  if (!to) throw new Error('destinatario mancante');

  const need = getNeed(session);
  const sku = getSKU(session);
  const excuse = await generateExcuse({ need, sku });

  const subject = `La tua scusa • ${need}`;
  const html = renderHtml({ excuse, need });
  const text = renderText({ excuse, need });

  await sendMail({
    from: MAIL_FROM,
    to,
    subject,
    html,
    text,
    replyTo,
  });

  return { to, subject };
}

module.exports = { sendCheckoutEmail };


  
