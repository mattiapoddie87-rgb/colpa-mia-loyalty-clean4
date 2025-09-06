// netlify/functions/stripe-webhook.js
// Gestisce checkout a PAGAMENTO e a 0€ (promo / coupon). Sempre genera scuse,
// accredita minuti su Customer metadata e invia email + WhatsApp.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resendKey = (process.env.RESEND_API_KEY || '').trim();
const resend = resendKey ? new Resend(resendKey) : null;
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = (process.env.TWILIO_FROM_WA || '').trim(); // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken ? require('twilio')(twilioSid, twilioToken) : null);

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
function j(s,b){ return { statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}; }
function pick(o,p,def=null){ try{ return p.split('.').reduce((a,c)=>a?.[c],o) ?? def }catch{ return def } }
function readJSONenv(k){ try{ return JSON.parse(process.env[k]||'{}') }catch{ return {} } }

// ---- Regole minuti: supporta sia mappa per SKU (lookup_key) sia per price.id
const RULES = readJSONenv('PRICE_RULES_JSON'); // es: {"SCUSA_BASE":{"minutes":10,"excuse":"base"}, ...}

function resolveRule(li){
  const price = li?.price || {};
  const sku = price.lookup_key || price.metadata?.sku || '';
  const bySku = sku && RULES[sku];
  const byId  = RULES[price.id];
  return bySku || byId || {};
}

// ---- AI excuses via function locale, con fallback sicuro
async function generateExcusesAI(context, productTag){
  const payload = {
    need: (context||'').slice(0,300) || 'ritardo generico',
    style:'neutro', persona: productTag || 'generico', locale:'it-IT', maxLen:300
  };
  try{
    const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const data = await r.json().catch(()=> ({}));
    const v = Array.isArray(data?.variants) ? data.variants.slice(0,3) : [];
    if (v.length) return v;
  }catch{}
  return [
    { sms:`Imprevisto ora, sto riorganizzando. Ti aggiorno entro sera.`,
      whatsapp_text:`È saltata fuori una cosa urgente e sto riorganizzando. Ti scrivo entro le 18 con un orario chiaro.`,
      email_subject:`Aggiornamento sui tempi`,
      email_body:`Ciao, è sopraggiunto un imprevisto che sto gestendo. Ti aggiorno entro le 18 con un nuovo orario affidabile.`,
      escalation:'', risk_score:0, red_flags:[] }
  ];
}

// ---- Email
async function sendEmail(to, minutes, variants){
  if (!resend) return { ok:false, reason:'no_resend_key' };
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v=>`<p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px">${v.whatsapp_text || v.sms || ''}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes}</b> minuti sul wallet.</p>
    </div>`;
  await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
  return { ok:true };
}

// ---- WhatsApp
function toWa(toRaw, defaultCC='+39'){
  let s = String(toRaw||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(s)) return s;
  if (/^\+\d{6,15}$/.test(s)) return `whatsapp:${s}`;
  const d = s.replace(/[^\d]/g,'').replace(/^00/,'');
  const cc = (defaultCC||'+39').replace('+','');
  const num = d.startsWith(cc) ? d : cc + d;
  return `whatsapp:+${num}`;
}
async function sendWhatsApp(toRaw, txt){
  if (!twilio || !twilioFromWa) return { ok:false, reason:'twilio_not_configured' };
  try{
    await twilio.messages.create({ from: twilioFromWa, to: toWa(toRaw), body: txt });
    return { ok:true };
  }catch(err){ return { ok:false, reason: String(err?.message||'wa_error') }; }
}

// ---- Accredita minuti: cumula in Customer.metadata.cm_minutes (intero)
async function creditMinutesOnCustomer(customerId, email, delta){
  const safe = v => Math.max(0, parseInt(v||0,10)||0);
  let customer = null;
  if (customerId) {
    customer = await stripe.customers.retrieve(customerId);
  } else if (email) {
    const found = await stripe.customers.search({ query: `email:'${email.replace(/'/g,"\\'")}'`, limit:1 });
    customer = found?.data?.[0] || null;
  }
  if (!customer && email) {
    customer = await stripe.customers.create({ email });
  }
  if (!customer) return { ok:false, reason:'no_customer' };
  const cur = safe(customer.metadata?.cm_minutes);
  const next = cur + safe(delta);
  await stripe.customers.update(customer.id, { metadata: { ...(customer.metadata||{}), cm_minutes: String(next) } });
  return { ok:true, customerId: customer.id, minutes: next };
}

exports.handler = async (event) => {
  try{
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return j(400,{ error:'missing_signature' });
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const ev = stripe.webhooks.constructEvent(event.body, sig, whSecret);

    // Trattiamo SEMPRE checkout.session.completed (anche a 0€)
    if (ev.type !== 'checkout.session.completed') return j(200,{ received:true, ignored: ev.type });

    const session = ev.data.object;
    // Pi può essere nullo con promo/coupon a 0€
    const piId = session.payment_intent ? String(session.payment_intent) : null;

    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return j(200, { ok:true, ignored:'missing_email' });

    // Leggiamo line items per minuti e “excuse tag”
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit:100, expand:['data.price.product'] });
    let minutes = 0, productTag = '';
    for (const li of (items?.data||[])) {
      const rule = resolveRule(li);
      minutes += (Number(rule.minutes||0) * (li.quantity||1)) || 0;
      if (!productTag && rule.excuse) productTag = String(rule.excuse);
    }
    // context dal campo custom (se presente)
    let context = '';
    const cfs = Array.isArray(session.custom_fields) ? session.custom_fields : [];
    for (const cf of cfs) {
      if ((cf.key||'').toLowerCase()==='need' && cf.text?.value) context = String(cf.text.value).trim();
    }

    // Genera scuse
    const variants = await generateExcusesAI(context, productTag);

    // Accredita minuti su Customer
    const credit = await creditMinutesOnCustomer(session.customer || null, email, minutes);

    // Email + WhatsApp
    await sendEmail(email, minutes, variants);

    const phones = new Set();
    const sPhone = pick(session,'customer_details.phone'); if (sPhone) phones.add(sPhone);
    const cfPhone = cfs.find(x => (x.key||'').toLowerCase()==='phone' && x.text?.value)?.text?.value; if (cfPhone) phones.add(cfPhone);

    const waText = [
      'COLPA MIA — La tua Scusa (3 varianti):',
      ...variants.map((v,i)=> `${i+1}) ${v.whatsapp_text || v.sms || ''}`),
      '',
      `(+${minutes} min accreditati sul wallet)`
    ].join('\n');

    let waStatus = 'no_phone';
    for (const p of phones){
      const res = await sendWhatsApp(p, waText);
      if (res.ok){ waStatus = 'sent'; break; } else waStatus = 'error';
    }

    // Se esiste PI, aggiorno metadata (facoltativo)
    if (piId){
      try{
        const pi = await stripe.paymentIntents.retrieve(piId);
        await stripe.paymentIntents.update(piId, {
          metadata: {
            ...(pi.metadata||{}),
            cm_excuses: '3',
            cm_minutesCredited: String(minutes),
            cm_emailSent: 'true',
            cm_waStatus: waStatus
          }
        });
      }catch{}
    }

    return j(200,{ ok:true, email, minutes, waStatus, promo: session.payment_status==='no_payment_required' });

  }catch(err){
    return j(500,{ error: String(err?.message||'webhook_error') });
  }
};
