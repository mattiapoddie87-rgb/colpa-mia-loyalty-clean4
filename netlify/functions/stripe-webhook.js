// Stripe webhook: accredita minuti, genera scuse (AI o fallback) e invia email.
// Richiede: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Opzionali: PRICE_RULES_JSON (per price.id) | PRICE_RULES_BY_SKU_JSON (per SKU/lookup_key)
// Opzionali: RESEND_API_KEY, RESEND_FROM (o MAIL_FROM)

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

function readJsonEnv(key) { try { return JSON.parse(process.env[key] || '{}'); } catch { return {}; } }
const RULES_BY_PRICE = readJsonEnv('PRICE_RULES_JSON');            // { "price_xxx": { minutes, excuse } }
const RULES_BY_SKU   = readJsonEnv('PRICE_RULES_BY_SKU_JSON');      // { "SCUSA_BASE": { minutes, excuse }, ... }

function fallbackExcuses(need = '') {
  const v1 = `Ho avuto un imprevisto serio e sto riorganizzando al volo. Ti aggiorno entro le 18 con un orario affidabile. (${need.slice(0,80)})`;
  const v2 = `È saltata fuori una cosa urgente che non posso rimandare: riduco il ritardo e ti do ETA entro sera.`;
  const v3 = `Situazione imprevista che mi blocca pochi minuti: non voglio darti buca, ti invio un nuovo slot a breve.`;
  return [v1, v2, v3];
}

async function getExcuses(need, persona) {
  // Prova l’endpoint locale ai-excuse; se fallisce, usa fallback.
  try {
    const origin = process.env.SITE_URL || 'https://colpamia.com';
    const r = await fetch(`${origin}/.netlify/functions/ai-excuse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ need, style: 'neutro', persona: persona || 'generico', locale: 'it-IT', maxLen: 300 })
    });
    const data = await r.json().catch(() => ({}));
    const variants = (data?.variants || [])
      .map(v => String(v?.whatsapp_text || v?.sms || '').trim())
      .filter(Boolean);
    if (variants.length) return variants.slice(0, 3);
  } catch {} // ignora
  return fallbackExcuses(need);
}

function pick(obj, path, def = null) {
  try { return path.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), obj) ?? def; } catch { return def; }
}

function minutesFromRule(rule, qty) {
  const m = Number(rule?.minutes || 0);
  return (isFinite(m) ? m : 0) * (Number(qty || 1) || 1);
}

function first(v) { return v.find(Boolean); }

function skuCandidates(li) {
  const price = li?.price || {};
  const product = price?.product || {};
  return [
    price.lookup_key,
    pick(price, 'metadata.sku'),
    pick(product, 'metadata.sku'),
  ].filter(Boolean);
}

function findRuleForLineItem(li) {
  const priceId = li?.price?.id;
  if (priceId && RULES_BY_PRICE[priceId]) return { rule: RULES_BY_PRICE[priceId], via: 'price' };

  for (const k of skuCandidates(li)) {
    if (RULES_BY_SKU[k]) return { rule: RULES_BY_SKU[k], via: 'sku', key: k };
  }
  return { rule: null, via: 'none' };
}

async function computeMinutes(session) {
  const items = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100,
    expand: ['data.price.product']
  });

  let total = 0;
  let tag = '';
  for (const li of items.data) {
    const { rule } = findRuleForLineItem(li);
    if (rule) {
      total += minutesFromRule(rule, li.quantity);
      if (!tag && rule.excuse) tag = rule.excuse;
    }
  }
  return { minutes: total, tag };
}

async function sendEmail(to, minutes, excuses) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key || !to) return false;
  const resend = new Resend(key);

  const variants = (excuses && excuses.length) ? excuses : fallbackExcuses();
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v => `<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${v}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
      <p style="font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
    </div>`;
  await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) return j(400, { error: 'missing_signature' });

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return j(400, { error: `invalid_signature: ${err.message}` });
  }

  // Gestiamo session.completed (ed eventuale async_payment_succeeded)
  const types = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
  if (!types.has(stripeEvent.type)) return j(200, { received: true, ignored: stripeEvent.type });

  const session = stripeEvent.data.object;
  if (session.mode !== 'payment') return j(200, { received: true, ignored: 'not_payment' });

  const piId = String(session.payment_intent || '');
  if (!piId) return j(200, { ok: true, ignored: 'no_payment_intent' });

  // Idempotenza: non ricreditare due volte
  const pi = await stripe.paymentIntents.retrieve(piId);
  if (pi?.metadata?.cm_credited === 'true') return j(200, { ok: true, already: true });

  // 1) Calcolo minuti dai line items
  const { minutes, tag } = await computeMinutes(session);

  // 2) Recupero contesto scritto dall’utente in checkout (custom field "need")
  let need = '';
  const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  for (const cf of cfs) {
    if (String(cf?.key || '').toLowerCase() === 'need' && cf?.text?.value) {
      need = String(cf.text.value || '').trim();
      break;
    }
  }

  // 3) Genera scuse (AI o fallback)
  const excuses = await getExcuses(need, tag);

  // 4) Aggiorna Customer metadata con somma minuti
  const customerId = session.customer || pi.customer;
  let newTotal = minutes;
  if (customerId) {
    try {
      const cust = await stripe.customers.retrieve(customerId);
      const prev = Number(cust?.metadata?.cm_minutes || 0) || 0;
      newTotal += prev;
      await stripe.customers.update(customerId, {
        metadata: { cm_minutes: String(newTotal) }
      });
    } catch {}
  }

  // 5) Marca il PaymentIntent come accreditato
  await stripe.paymentIntents.update(piId, {
    metadata: {
      ...(pi.metadata || {}),
      cm_credited: 'true',
      cm_minutes_delta: String(minutes),
      cm_excuse_tag: tag || ''
    }
  });

  // 6) Email best-effort
  const emailTo = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  if (emailTo) {
    try { await sendEmail(emailTo, minutes, excuses); } catch {}
  }

  return j(200, { ok: true, minutes, email: emailTo || null });
};
