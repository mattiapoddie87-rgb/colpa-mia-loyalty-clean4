// stripe-webhook.js — accredita minuti, invia WA+email, passa lo SKU ad ai-excuse
// Dipendenze: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, SITE_URL,
//             (opz.) TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_WA,
//             PRICE_RULES_JSON, PRICE_BY_SKU_JSON

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const fetchFn = (...a) => fetch(...a);

const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL   = String(process.env.SITE_URL || '').replace(/\/+$/,'');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim(); // 'whatsapp:+14155238886'

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

/* ---------- utils ---------- */
function parseJSONenv(k){ try { return JSON.parse(process.env[k] || '{}'); } catch { return {}; } }
const RULES = parseJSONenv('PRICE_RULES_JSON');       // { price_...: {excuse, minutes} }
const MAP_BY_SKU = parseJSONenv('PRICE_BY_SKU_JSON'); // { SCUSA_BASE: "price_..." }
const SKU_BY_PRICE = Object.fromEntries(Object.entries(MAP_BY_SKU).map(([s,p]) => [p, s]));
const pick=(x,p,d=null)=>{ try { return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; } catch { return d; } };

/** Somma minuti dalle line items: regole ENV > metadata.price > metadata.product */
async function minutesFromLineItems(session){
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit:100, expand:['data.price.product'] }).catch(()=>({data:[]}));
  let sum = 0;
  for (const li of (items.data || [])){
    const qty = li?.quantity || 1;
    const priceId = li?.price?.id;
    if (priceId && RULES[priceId]) { sum += Number(RULES[priceId].minutes || 0) * qty; continue; }
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

/** Ricava lo SKU della session (client_reference_id, metadata, lookup_key, mappa ENV) */
async function detectSku(session){
  if (session.client_reference_id) return String(session.client_reference_id).toUpperCase();
  if (session.metadata?.sku)       return String(session.metadata.sku).toUpperCase();
  try{
    const li = (await stripe.checkout.sessions.listLineItems(session.id,{limit:1,expand:['data.price.product']})).data?.[0];
    return String(
      li?.price?.lookup_key ||
      SKU_BY_PRICE[li?.price?.id] ||
      li?.price?.metadata?.sku ||
      li?.price?.product?.metadata?.sku ||
      ''
    ).toUpperCase() || null;
  }catch{ return null; }
}

/** Chiama la function locale che produce 3 varianti coerenti con lo SKU */
async function getExcuses({ sku, tone='neutro', locale='it-IT' }){
  const url = `${SITE_URL}/.netlify/functions/ai-excuse`;
  const r = await fetchFn(url,{
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ sku, tone, maxLen:320, locale })
  });
  const data = await r.json().catch(()=> ({}));
  const arr = Array.isArray(data?.variants) ? data.variants.slice(0,3) : [];
  return arr.map(v => String(v.whatsapp_text||'').trim()).filter(Boolean);
}

/** WhatsApp (Twilio) */
async function sendWhatsApp(toNumber, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'no_twilio' };
  if (!toNumber || !/^\+\d{6,15}$/.test(toNumber)) return { ok:false, reason:'bad_phone' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ From: TW_FROM_WA, To: `whatsapp:${toNumber}`, Body: text }).toString();
  const r = await fetchFn(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded',
              'Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64') },
    body
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

/** Email (Resend) */
async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend' };
  const r = await fetchFn('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from:'COLPA MIA <onboarding@resend.dev>', to:[to], subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

/* ---------- webhook ---------- */
exports.handler = async (event) => {
  // verifica firma
  const sig = event.headers['stripe-signature'];
  let type, obj;
  try{
    const evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    type = evt.type;
    obj  = evt.data.object;
  }catch(err){
    return j(400, { error:'invalid_signature', detail:String(err?.message||err) });
  }

  if (type !== 'checkout.session.completed') {
    return j(200, { ok:true, ignored:true });
  }

  try{
    const session = await stripe.checkout.sessions.retrieve(obj.id, { expand:['total_details.breakdown'] });

    const email  = String(session?.customer_details?.email || '').toLowerCase();
    const phone  = String(session?.customer_details?.phone || '');
    const locale = String(session?.locale || 'it-IT');

    const minutes = await minutesFromLineItems(session);
    const sku = (await detectSku(session)) || 'SCUSA_BASE';

    // 3 varianti coerenti con lo SKU
    const variants = await getExcuses({ sku, locale });

    // WhatsApp (prima variante)
    let waSent = false;
    if (variants[0] && phone) {
      const body = `COLPA MIA — La tua Scusa\n\n${variants[0]}\n\n(+${minutes} min accreditati sul wallet)`;
      const wa = await sendWhatsApp(phone, body);
      waSent = !!wa.ok;
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

    // Persisto sul PaymentIntent (utile per il wallet guest)
    if (session.payment_intent) {
      const meta = {
        minutesCredited: String(minutes),
        excusesCount: String(variants.length || 0),
        colpamiaEmailSent: emailSent ? 'true' : 'false',
        colpamiaWaStatus: waSent ? 'sent' : 'skip',
      };
      if (email) meta.customerEmail = email;
      try { await stripe.paymentIntents.update(session.payment_intent, { metadata: meta }); } catch {}
    }

    return j(200, { ok:true, sku, minutes, waSent, emailSent, variants: variants.length });
  }catch(err){
    return j(500, { error:'webhook_error', detail:String(err?.message||err) });
  }
};
