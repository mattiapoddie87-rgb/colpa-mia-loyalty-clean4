// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const { buffer } = require('micro');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Usa il tuo modulo di generazione testi.
// Se non esiste/va in errore, useremo un fallback.
let ai;
try { ai = require('./ai-excuse'); } catch { ai = null; }

const FROM_NAME = 'COLPA MIA';
const FROM_EMAIL = 'no-reply@colpamia.com';
const REPLY_TO  = 'colpamiaconsulenze@proton.me';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Stripe-Signature'
};
const json = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

// Sanitize/escape HTML min.
const esc = (s)=>String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function coerceLines(arr) {
  // accetta stringhe o oggetti {text: "..."}
  return (arr || []).map(v => {
    if (typeof v === 'string') return v;
    if (v && typeof v.text === 'string') return v.text;
    if (v && typeof v.msg  === 'string') return v.msg;
    return String(v);
  });
}

async function sendEmailViaResend(to, subject, html, text) {
  // Resend API semplice via fetch
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('missing RESEND_API_KEY');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text,
      reply_to: REPLY_TO
    })
  });

  if (!r.ok) {
    const body = await r.text().catch(()=> '');
    throw new Error(`resend_failed: ${r.status} ${body}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  try {
    const sig = event.headers['stripe-signature'];
    const raw = Buffer.from(event.body || '', 'utf8');
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let stripeEvent;

    try {
      stripeEvent = stripe.webhooks.constructEvent(raw, sig, whSecret);
    } catch (e) {
      return json(400, { error: 'invalid_signature', detail: String(e.message || e) });
    }

    if (stripeEvent.type !== 'checkout.session.completed') {
      return json(200, { ok:true, ignored: stripeEvent.type });
    }

    const session = stripeEvent.data.object;

    // email cliente
    const email =
      session.customer_details?.email ||
      session.customer_email ||
      session.metadata?.email ||
      null;

    // SKU
    const sku = session.client_reference_id || session.metadata?.sku || 'UNKNOWN';

    // Recupero il contesto dal campo custom "need"
    let contextUsed = '';
    try {
      const f = (session.custom_fields || []).find(x => x.key === 'need');
      contextUsed = f?.text?.value || '';
    } catch {}

    // Calcolo minuti wallet per SKU
    const ruleMap = JSON.parse(process.env.PRICE_RULES_JSON || '{}');
    const rule = ruleMap[sku] || {};
    const minutes = parseInt(rule.minutes || 0, 10) || 0;

    // Generazione testi scuse (usa ai-excuse se disponibile)
    let title = 'La tua Scusa';
    let lines = [];
    try {
      if (ai && typeof ai.generateExcuse === 'function') {
        const out = await ai.generateExcuse({ sku, context: contextUsed });
        title = out?.title || title;
        lines = coerceLines(out?.variants || out?.lines || []);
      }
    } catch {}

    // fallback se vuoto
    if (!lines.length) {
      if (sku === 'SCUSA_BASE') {
        lines = [`Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.`];
        title = 'Scusa Base';
      } else if (sku === 'SCUSA_DELUXE') {
        lines = [
          `Ciao, piccolo imprevisto ma ho già un piano: ti scrivo tra poco con orari aggiornati.`,
          `Sto chiudendo una cosa urgente. Preferisco darti orari credibili appena li ho.`,
          `Piccolo intoppo organizzativo, mi rimetto in carreggiata e ti aggiorno a breve.`
        ];
        title = 'Scusa Deluxe';
      } else {
        lines = [`Ciao, ho avuto un imprevisto. Ti aggiorno a breve.`];
      }
    }

    // Se BASE → una sola scusa
    if (sku === 'SCUSA_BASE') lines = [ lines[0] ];

    // Accredita wallet (retrocompatibile, salva per email)
    let walletAfter = null;
    try {
      if (email && minutes > 0) {
        const kv = globalThis.__WALLETS__ ||= new Map(); // semplice store in-memory (se vuoi, sostituisci con KV esterno)
        const cur = parseInt(kv.get(email) || 0, 10) || 0;
        walletAfter = cur + minutes;
        kv.set(email, walletAfter);
      }
    } catch {}

    // Email finale
    const ol = '<ol>' + lines.map(s => `<li>${esc(s)}</li>`).join('') + '</ol>';
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
        <h2 style="margin:0 0 8px">${esc(title)}</h2>
        ${ol}
        ${minutes>0 ? `<p style="margin-top:16px">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>` : ''}
        <p style="margin-top:16px;font-size:12px;color:#667">
          In caso di problemi rispondi a <a href="mailto:${esc(REPLY_TO)}">${esc(REPLY_TO)}</a>.
        </p>
      </div>
    `;
    const text = `${title}\n\n${lines.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\n${minutes>0 ? `Accreditati ${minutes} minuti sul tuo wallet.`:''}`;

    if (email) await sendEmailViaResend(email, title, html, text);

    return json(200, {
      ok: true,
      session_id: session.id,
      sku,
      title,
      email,
      credited: minutes,
      wallet_after: walletAfter,
      context_used: contextUsed
    });
  } catch (e) {
    return json(500, { error: 'unhandled', detail: String(e.message || e) });
  }
};
