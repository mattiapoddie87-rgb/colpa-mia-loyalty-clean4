// netlify/functions/session-email.js
// Usa i modelli di ai-excuse.js per generare la scusa e inviarla via email.
const { sendMail } = require('./send-utils');
const aiExcuse = require('./ai-excuse'); // { handler }

const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <noreply@colpamia.com>';

// ---- helpers ----
function getNeed(session) {
  if (session?.metadata?.need) return String(session.metadata.need).trim();
  const cf = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  const found = cf.find(f => f?.key === 'need' && f?.type === 'text' && f?.text?.value);
  if (found?.text?.value) return String(found.text.value).trim();
  return (session?.client_reference_id || session?.metadata?.sku || 'SCUSA_BASE').toString().trim();
}

function getSKU(session) {
  return (session?.metadata?.sku || session?.client_reference_id || 'SCUSA_BASE')
    .toString().trim().toUpperCase();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderHtml({ need, variants }) {
  const items = variants.map((t, i) =>
    `<div style="margin:12px 0;white-space:pre-wrap">${escapeHtml(`${t}`)}</div>`).join('');
  return `<!doctype html><html lang="it"><meta charset="utf-8">
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;margin:0;padding:24px;background:#fafafa">
  <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">
    <h1 style="font-size:20px;margin:0 0 12px">La tua scusa è pronta</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#555">Contesto: <strong>${escapeHtml(need)}</strong></p>
    ${items}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="font-size:12px;color:#777">Per modifiche, rispondi a questa email indicando correzioni o vincoli.</p>
  </div>
</body></html>`;
}

function renderText({ need, variants }) {
  const body = variants.map((t, i) => `${t}`).join('\n\n');
  return `La tua scusa è pronta\nContesto: ${need}\n\n${body}\n`;
}

// ---- core: usa ai-excuse.js ----
async function getExcuseVariants({ sku, need }) {
  const event = {
    httpMethod: 'POST',
    body: JSON.stringify({ sku, need })
  };
  const res = await aiExcuse.handler(event);
  if (!res || res.statusCode !== 200) {
    throw new Error(`ai_excuse_error: ${res && res.body ? res.body : 'no_response'}`);
  }
  const payload = JSON.parse(res.body || '{}');
  const variants = Array.isArray(payload.variants)
    ? payload.variants.map(v => v && (v.text || v.whatsapp_text)).filter(Boolean)
    : [];
  if (!variants.length) throw new Error('ai_excuse_empty');
  return variants;
}

// API usata dal webhook
async function sendCheckoutEmail({ session, lineItems, overrideTo, replyTo }) {
  const to =
    overrideTo ||
    session?.customer_details?.email ||
    session?.customer_email;
  if (!to) throw new Error('destinatario mancante');

  const need = getNeed(session);
  const sku = getSKU(session);

  // prendi i testi direttamente da ai-excuse.js
  const variants = await getExcuseVariants({ sku, need });

  const subject = `La tua scusa • ${need}`;
  const html = renderHtml({ need, variants });
  const text = renderText({ need, variants });

  await sendMail({ from: MAIL_FROM, to, subject, html, text, replyTo });
  return { to, subject };
}

module.exports = { sendCheckoutEmail };
