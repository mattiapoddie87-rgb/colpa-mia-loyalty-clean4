```js
// netlify/functions/stripe-webhook.js
// Accredito minuti + invio email + (opz.) WhatsApp. Robusto ai fallback.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

/* ------------------- utils ------------------- */
const http = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const pick = (x, path, d = null) => {
  try {
    return path.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), x) ?? d;
  } catch { return d; }
};
const jsonEnv = (k) => { try { return JSON.parse(process.env[k] || '{}'); } catch { return {}; } };

const PRICE_RULES = jsonEnv('PRICE_RULES_JSON'); // { price_xxx: { minutes, excuse } }
const DEFAULT_CC = (process.env.DEFAULT_COUNTRY_CODE || '+39').trim();

function onlyDigits(s){ return String(s || '').replace(/[^\d]/g, ''); }
function isE164(s){ return /^\+\d{6,15}$/.test(String(s || '')); }
function asWhatsApp(toRaw){
  let to = String(toRaw || '').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(to)) return to;
  if (isE164(to)) return `whatsapp:${to}`;
  let d = onlyDigits(to);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = DEFAULT_CC.replace('+','');
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}

/* ------------------- AI excuses (con fallback duro) ------------------- */
async function generateExcusesAI(context, productTag){
  const HARD = [
    'Imprevisto ora, riorganizzo e ti aggiorno a breve.',
    'È saltata fuori una cosa urgente: ti scrivo entro poco con un orario chiaro.',
    'Sto gestendo un imprevisto, ti aggiorno entro sera con un nuovo slot.'
  ];

  // se non c’è chiave OpenAI lascia stare e torna fallback
  if (!/^sk-/.test((process.env.OPENAI_API_KEY || '').trim()))
    return { short: HARD[0], variants: HARD };

  const origin = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
  const payload = { need: context || productTag || 'ritardo', style: 'neutro', persona: (productTag || 'generico'), locale: 'it-IT', maxLen: 300 };

  try{
    const r = await fetch(`${origin}/.netlify/functions/ai-excuse`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const data = await r.json().catch(()=> ({}));
    const list = (data?.variants || [])
      .map(x => String(x?.whatsapp_text || x?.sms || '').trim())
      .filter(Boolean);
    if (list.length) return { short: list[0], variants: list.slice(0,3) };
  }catch{}

  return { short: HARD[0], variants: HARD };
}

/* ------------------- email (Resend, best-effort) ------------------- */
async function sendEmail(to, minutes, excuses){
  const { Resend } = require('resend');
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return { ok:false, reason:'no_resend_key' };

  const variants = (Array.isArray(excuses?.variants) ? excuses.variants : []).filter(Boolean);
  const safe = variants.length ? variants : [
    'Imprevisto ora, riorganizzo e ti aggiorno a breve.',
    'È saltata fuori una cosa urgente: ti scrivo entro poco con un orario chiaro.',
    'Sto gestendo un imprevisto, ti aggiorno entro sera con un nuovo slot.'
  ];

  const resend = new Resend(key);
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${safe.map(v=>`<p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px;">${v}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
      <p style="font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
    </div>`;

  try{
    await resend.emails.send({ from, to, subject: 'La tua scusa è pronta ✅', html });
    return { ok:true };
  }catch(err){
    return { ok:false, reason:String(err?.message||'send_error') };
  }
}

/* ------------------- WhatsApp (opzionale) ------------------- */
const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken ? require('twilio')(twilioSid, twilioToken) : null);

async function sendWhatsApp(toRaw, message, paymentIntentId){
  if (!twilio || !twilioFromWa) return { ok:false, reason:'twilio_not_configured' };
  const to = asWhatsApp(toRaw);
  try{
    await twilio.messages.create({ from: twilioFromWa, to, body: message });
    return { ok:true };
  }catch(err){
    try{
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          ...( (await stripe.paymentIntents.retrieve(paymentIntentId)).metadata || {} ),
          colpamiaWaError: String(err?.message || err?.code || 'wa_error')
        }
      });
    }catch{}
    return { ok:false, reason: String(err?.message || 'wa_error') };
  }
}

/* ------------------- phone sources ------------------- */
async function getPhoneCandidates(session, paymentIntent){
  const out = new Set();

  const sPhone = pick(session, 'customer_details.phone'); if (sPhone) out.add(sPhone);
  const chPhone = pick(paymentIntent, 'charges.data.0.billing_details.phone'); if (chPhone) out.add(chPhone);

  const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  cfs.forEach(cf => { if (cf?.key?.toLowerCase()==='phone' && cf?.text?.value) out.add(cf.text.value); });

  const customerId = session.customer || paymentIntent.customer;
  if (customerId){
    try{
      const customer = await stripe.customers.retrieve(customerId);
      if (customer?.phone) out.add(customer.phone);
      if (customer?.metadata?.phone) out.add(customer.metadata.phone);
    }catch{}
  }

  return Array.from(out);
}

/* ------------------- accredito (placeholder reale) ------------------- */
async function creditMinutes(email, minutes){ return true; }

/* ------------------- handler ------------------- */
exports.handler = async (event) => {
  try{
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return http(400, { error: 'missing_signature' });

    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeEvent = stripe.webhooks.constructEvent(event.body, sig, whSecret);

    if (stripeEvent.type !== 'checkout.session.completed')
      return http(200, { received: true, ignored: stripeEvent.type });

    const session = stripeEvent.data.object;
    if (session.mode !== 'payment') return http(200, { received: true, ignored: 'not_payment' });

    const piId = String(session.payment_intent || '');
    if (!piId) return http(400, { error: 'missing_payment_intent' });

    let pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.colpamiaCredited === 'true') return http(200, { ok: true, already: true });

    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return http(400, { error: 'missing_email' });

    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ['data.price.product'] });

    const rulesByPrice = PRICE_RULES || {};
    let rulesBySku = {};
    try { rulesBySku = JSON.parse(process.env.SKU_RULES_JSON || '{}'); } catch {}

    let minutes = 0;
    let productTag = '';

    for (const li of items.data) {
      const priceId = li?.price?.id || '';
      const qty = li?.quantity || 1;

      const skuGuess = String(
        (li?.price?.lookup_key) ||
        (li?.price?.product?.metadata?.sku) ||
        (session?.metadata?.sku) ||
        ''
      ).toUpperCase();

      const rule = rulesByPrice[priceId] || rulesBySku[skuGuess] || {};
      minutes += (Number(rule.minutes || 0) * qty) || 0;
      if (!productTag && rule.excuse) productTag = rule.excuse;
    }

    if (minutes <= 0) return http(200, { ok:true, ignored:'no_minutes' });

    let context = '';
    const customFields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
    for (const cf of customFields) {
      if (cf?.key?.toLowerCase() === 'need' && cf?.text?.value) {
        context = String(cf.text.value || '').trim();
        break;
      }
    }

    // AI + guard-rail duro
    let excuses = await generateExcusesAI(context, productTag);
    const HARD = [
      'Imprevisto ora, riorganizzo e ti aggiorno a breve.',
      'È saltata fuori una cosa urgente: ti scrivo entro poco con un orario chiaro.',
      'Sto gestendo un imprevisto, ti aggiorno entro sera con un nuovo slot.'
    ];
    if (!excuses || !Array.isArray(excuses.variants)) excuses = { short: HARD[0], variants: HARD };
    if (excuses.variants.filter(Boolean).length === 0) excuses.variants = HARD;

    await creditMinutes(email, minutes);
    await sendEmail(email, minutes, excuses); // best-effort

    // WhatsApp opzionale
    const phoneCandidates = await getPhoneCandidates(session, pi);
    let waStatus = 'no_phone';
    if (phoneCandidates.length) {
      const waText = [
        'La tua Scusa (3 varianti):',
        ...excuses.variants.map((v, i) => `${i + 1}) ${v}`),
        '',
        `(+${minutes} min accreditati su COLPA MIA)`
      ].join('\n');

      for (const raw of phoneCandidates) {
        const res = await sendWhatsApp(raw, waText, piId);
        if (res.ok){ waStatus = 'sent'; break; }
        else { waStatus = 'error'; }
      }
    }

    // metadati PI
    try{
      pi = await stripe.paymentIntents.update(piId, {
        metadata: {
          ...(pi.metadata || {}),
          colpamiaCredited: 'true',
          colpamiaEmailSent: 'true',
          colpamiaWhatsAppTried: String(!!phoneCandidates.length),
          colpamiaWaStatus: waStatus,
          minutesCredited: String(minutes),
          excusesCount: '3'
        }
      });
    }catch{}

    return http(200, { ok:true, minutes, email, waStatus });
  }catch(err){
    return http(500, { error: String(err?.message || 'webhook_error') });
  }
};
```
