// netlify/functions/session-email.js
// Invia l'email "La tua scusa" con 3 varianti generate dall'AI.

const { Resend } = require('resend');

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/, '');
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM =
  process.env.RESEND_FROM ||
  process.env.MAIL_FROM ||
  'COLPA MIA <onboarding@resend.dev>';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(b),
});

// --- chiede a /.netlify/functions/ai-excuse le 3 varianti ---
async function generateExcusesAI({ need, persona = 'generico', style = 'neutro' }) {
  try {
    const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        need: String(need || '').slice(0, 400),
        persona,
        style,
        locale: 'it-IT',
        maxLen: 300,
      }),
    });
    const data = await r.json().catch(() => ({}));
    const v = Array.isArray(data?.variants) ? data.variants.slice(0, 3) : [];
    if (v.length) return v;
  } catch (_) {}
  // fallback
  return [
    {
      whatsapp_text:
        'È saltata fuori una cosa urgente: arrivo più tardi. Ti aggiorno entro le 18 con un orario chiaro.',
      sms:
        'Imprevisto ora, sto riorganizzando. Ti aggiorno entro sera.',
    },
  ];
}

function htmlEmail(variants = [], minutes = 0) {
  const cards = variants
    .map(
      (v, i) =>
        `<p style="margin:10px 0;padding:12px;background:#0f1430;color:#f5f5f7;border:1px solid rgba(255,255,255,.1);border-radius:10px">
          <b>${i + 1})</b> ${v.whatsapp_text || v.sms || ''}
        </p>`
    )
    .join('');

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f5f5f7;background:#090e20;padding:16px">
    <h2 style="margin:0 0 12px">La tua scusa</h2>
    ${cards || '<p>Nessuna scusa generata.</p>'}
    <p style="margin-top:16px">Accreditati <b>${Number(minutes)||0} minuti</b> sul tuo wallet.</p>
    <p style="font-size:12px;opacity:.8">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return j(400, { error: 'bad_json' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const minutes = Number(body.minutes || 0) || 0;
  const need = String(body.need || '').trim();       // es. dal checkout "Contesto"
  const persona = String(body.persona || 'generico');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j(400, { error: 'invalid_email' });

  // 1) ottieni 3 varianti dall'AI
  const variants = await generateExcusesAI({ need, persona });

  // 2) invia email (best-effort)
  let emailSent = false;
  let reason = null;
  if (RESEND_KEY) {
    try {
      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from: MAIL_FROM,
        to: email,
        subject: 'La tua scusa',
        html: htmlEmail(variants, minutes),
      });
      emailSent = true;
    } catch (err) {
      reason = String(err?.message || 'send_error');
    }
  } else {
    reason = 'no_resend_key';
  }

  return j(200, { ok: true, emailSent, reason, variants_count: variants.length });
};
