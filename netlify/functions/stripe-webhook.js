// netlify/functions/stripe-webhook.js
// Flusso completo post-checkout:
// 1) Calcola minuti dai line_items (PRICE_RULES_JSON/metadata)
// 2) Genera 3 varianti coerenti con SKU/kind + hint (non copiato) via /.netlify/functions/ai-excuse
// 3) Invia WhatsApp (prima variante) e Email (3 varianti) 
// 4) Scrive metadata su PaymentIntent (minutesCredited, excusesCount, customerEmail, …)
// 5) Se NON esiste PI (promo code 100%), aggiorna Customer.metadata.wallet_minutes (persistenza)
//    Idempotenza: se già accreditato, non raddoppia.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// --- Config esterne
const SITE_URL   = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/, '');
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM = (process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>').trim();

const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim(); // 'whatsapp:+14155238886' (sandbox) / numero business

// --- Helpers HTTP
const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

// --- Utils
function parseRules() { try { return JSON.parse(process.env.PRICE_RULES_JSON || '{}'); } catch { return {}; } }
const pick = (x, p, d = null) => { try { return p.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), x) ?? d; } catch { return d; } };

// SKU -> kind
const KIND_BY_SKU = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione', CONN_KO:'connessione'
};
const CONTEXT_NOT_NEEDED = new Set(['riunione','traffico','connessione']);

// --- Minutes from line items (price rules / metadata fallback)
async function minutesFromLineItems(session) {
  const rules = parseRules();
  const items = await stripe.checkout.sessions
    .listLineItems(session.id, { limit: 100, expand: ['data.price.product'] })
    .catch(() => ({ data: [] }));

  let sum = 0;
  for (const li of (items.data || [])) {
    const qty = li?.quantity || 1;
    const priceId = li?.price?.id;
    if (priceId && rules[priceId]) { sum += Number(rules[priceId].minutes || 0) * qty; continue; }
    const m1 = Number(pick(li, 'price.metadata.minutes', 0)) || 0;
    const m2 = Number(pick(li, 'price.product.metadata.minutes', 0)) || 0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

// --- WhatsApp via Twilio
async function sendWhatsApp(e164Phone, text) {
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok: false, reason: 'twilio_not_configured' };
  if (!/^\+\d{6,15}$/.test(String(e164Phone || ''))) return { ok: false, reason: 'bad_phone' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({
    From: TW_FROM_WA,
    To: `whatsapp:${e164Phone}`,
    Body: text
  }).toString();

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')
    },
    body
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

// --- Email via Resend
async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return { ok: false, reason: 'no_resend_key' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html })
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

// --- Genera scuse dal motore interno
async function generateExcuses({ sku, kind, need, locale }) {
  try {
    const r = await fetch(`${SITE_URL}/.netlify/functions/ai-excuse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku, kind,
        need: CONTEXT_NOT_NEEDED.has(kind) ? '' : (need || ''),
        tone: 'neutro',
        locale: locale || 'it-IT',
        maxLen: 320
      })
    });
    const data = await r.json().catch(() => ({}));
    let arr = Array.isArray(data?.variants) ? data.variants : [];
    // normalizza
    arr = arr.map(v => String(v?.whatsapp_text || v?.sms || '').trim()).filter(Boolean);
    // 3 max
    if (arr.length > 3) arr = arr.slice(0, 3);
    // Fallback minimo se vuoto
    if (!arr.length) {
      arr = [
        'È saltato un intoppo operativo. Riduco il ritardo e ti scrivo un orario affidabile a breve.',
        'C’è stata un’urgenza. Preferisco darti tempi realistici: ti aggiorno tra poco.',
        'Piccolo imprevisto reale. Appena stabilizzato, ti propongo una nuova fascia con margine.'
      ];
    }
    return arr;
  } catch {
    return [
      'È saltato un intoppo operativo. Riduco il ritardo e ti scrivo un orario affidabile a breve.',
      'C’è stata un’urgenza. Preferisco darti tempi realistici: ti aggiorno tra poco.',
      'Piccolo imprevisto reale. Appena stabilizzato, ti propongo una nuova fascia con margine.'
    ];
  }
}

// --- Handler
exports.handler = async (event) => {
  // Verifica firma webhook
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  let type, obj;
  try {
    const evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    type = evt.type;
    obj  = evt.data.object;
  } catch (err) {
    return j(400, { error: 'invalid_signature', detail: String(err?.message || err) });
  }

  // Gestiamo solo il completamento checkout
  if (type !== 'checkout.session.completed') return j(200, { ok: true, ignored: type });

  try {
    // Session completa
    const session = await stripe.checkout.sessions.retrieve(obj.id, { expand: ['total_details.breakdown'] });

    // Idempotenza veloce: se PI ha già flag, esci
    if (session.payment_intent) {
      try {
        const pi0 = await stripe.paymentIntents.retrieve(session.payment_intent);
        if (pi0?.metadata?.colpamiaCredited === 'true') return j(200, { ok: true, already: true });
      } catch {}
    }

    // Email & phone dal checkout
    const email = String(pick(session, 'customer_details.email', '') || '').trim().toLowerCase();
    const phone = String(pick(session, 'customer_details.phone', '') || '').trim(); // dovrebbe essere in E.164 (+39…)

    // SKU/kind/need
    const sku  = String(session?.metadata?.sku || session?.client_reference_id || '').toUpperCase();
    const kind = KIND_BY_SKU[sku] || 'base';

    let need = '';
    if (!CONTEXT_NOT_NEEDED.has(kind)) {
      const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
      for (const cf of cfs) {
        if ((cf.key || '').toLowerCase() === 'need' && cf?.text?.value) { need = String(cf.text.value).trim(); break; }
      }
    }

    // Calcolo minuti (funziona anche con promo/no_payment_required)
    const minutes = await minutesFromLineItems(session);

    // Genera 3 varianti
    const variants = await generateExcuses({ sku, kind, need, locale: session.locale || 'it-IT' });

    // WhatsApp (prima variante, se numero valido)
    let waStatus = 'skip';
    if (/^\+\d{6,15}$/.test(phone) && variants[0]) {
      const wa = await sendWhatsApp(phone, `COLPA MIA — La tua Scusa:\n\n${variants[0]}\n\n(+${minutes} min accreditati sul wallet)`);
      waStatus = wa.ok ? 'sent' : 'error';
    }

    // Email (tutte e 3)
    let emailSent = false;
    if (email) {
      const bullet = variants.map(v => `<li>${v}</li>`).join('');
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.45;color:#111">
          <h2 style="margin:0 0 10px">La tua scusa</h2>
          <ul>${bullet}</ul>
          <p style="margin-top:14px;color:#444">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
        </div>`;
      const em = await sendEmail(email, 'La tua Scusa — COLPA MIA', html);
      emailSent = !!em.ok;
    }

    // Scrivi metadata su PaymentIntent (se esiste) + customerEmail (per wallet PI-search)
    if (session.payment_intent) {
      try {
        await stripe.paymentIntents.update(session.payment_intent, {
          metadata: {
            minutesCredited: String(minutes),
            excusesCount: String(variants.length || 0),
            colpamiaEmailSent: emailSent ? 'true' : 'false',
            colpamiaWaStatus: waStatus,
            ...(email ? { customerEmail: email } : {}),
            colpamiaCredited: 'true'
          }
        });
      } catch {}
    }

    // Persistenza anche su Customer (utile quando NON c’è PI: promo 100%)
    // create-checkout-session usa customer_creation:'always', quindi session.customer dovrebbe esserci.
    if (session.customer) {
      try {
        const c = await stripe.customers.retrieve(session.customer);
        const prev = Number(c?.metadata?.wallet_minutes || 0) || 0;
        const newVal = String(prev + (minutes || 0));
        await stripe.customers.update(c.id, {
          metadata: {
            wallet_minutes: newVal,
            lastExcusesCount: String(variants.length || 0),
            lastSessionId: session.id,
            ...(email ? { lastEmail: email } : {})
          }
        });
      } catch {}
    }

    return j(200, { ok: true, minutes, emailSent, waStatus, variants: variants.length });

  } catch (err) {
    return j(500, { error: 'webhook_error', detail: String(err?.message || err) });
  }
};
