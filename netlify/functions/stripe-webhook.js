// netlify/functions/stripe-webhook.js
// Webhook Stripe: accredita minuti, invia email, invia WhatsApp, genera scuse con AI.
// Funziona sia con pagamenti normali sia con checkout a €0 (promo 100%).

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const resend = new Resend(process.env.RESEND_API_KEY || '');

const MAIL_FROM =
  process.env.RESEND_FROM ||
  process.env.MAIL_FROM ||
  'COLPA MIA <onboarding@resend.dev>';

const twilioSid   = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN  || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken) ? require('twilio')(twilioSid, twilioToken) : null;

function http(s, b) { return { statusCode: s, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(b) }; }
function readJsonEnv(k){ try{ return JSON.parse(process.env[k]||'{}'); }catch{ return {}; } }

const RULES_BY_PRICE = readJsonEnv('PRICE_RULES_JSON');               // { price_xxx: {minutes, excuse} }
const RULES_BY_SKU   = readJsonEnv('PRICE_RULES_BY_SKU_JSON') || {};  // opzionale: { SCUSA_BASE: {minutes, excuse} }

const DEFAULT_CC = (process.env.DEFAULT_COUNTRY_CODE || '+39').trim();

const onlyDigits = s => String(s||'').replace(/[^\d]/g,'');
const isE164 = s => /^\+\d{6,15}$/.test(String(s||''));
function asWhatsApp(toRaw){
  let s = String(toRaw||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(s)) return s;
  if (isE164(s)) return `whatsapp:${s}`;
  let d = onlyDigits(s);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = DEFAULT_CC.replace('+','');
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}

async function sendWhatsApp(toRaw, message){
  if (!twilio || !twilioFromWa) return { ok:false, reason:'twilio_not_configured' };
  try{
    await twilio.messages.create({ from: twilioFromWa, to: asWhatsApp(toRaw), body: message });
    return { ok:true };
  }catch(err){
    return { ok:false, reason: String(err?.message || 'wa_error') };
  }
}

async function sendEmail(to, minutes, variants){
  if (!resend || !to) return;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v => `<p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px;">${v.whatsapp_text || v.sms || v.email_body || ''}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
    </div>`;
  try{
    await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
  }catch{}
}

async function generateExcusesAI(context, tag){
  const apiKey = process.env.OPENAI_API_KEY || '';
  // fallback se manca la chiave
  if (!/^sk-/.test(apiKey)) {
    const v = [
      `Mi è entrato un imprevisto serio, sto riorganizzando e ti aggiorno entro sera.`,
      `È saltata fuori una cosa urgente: sistemo e ti scrivo appena ho un orario affidabile.`,
      `Situazione imprevista, non voglio lasciarti in sospeso: ti mando un nuovo ETA tra poco.`
    ];
    return { variants: v.map(t => ({ sms:t, whatsapp_text:t, email_subject:'Aggiornamento', email_body:t })) };
  }
  try{
    const r = await fetch(`${process.env.SITE_URL || 'https://colpamia.com'}/.netlify/functions/ai-excuse`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ need:context||tag||'ritardo', style:'neutro', persona:tag||'generico', locale:'it-IT', maxLen:300 })
    });
    const data = await r.json().catch(()=> ({}));
    if (Array.isArray(data?.variants) && data.variants.length) return data;
  }catch{}
  // fallback duro
  return { variants: [
    { sms:`Imprevisto ora, ti aggiorno entro sera.`, whatsapp_text:`Imprevisto ora, ti aggiorno entro sera.`, email_subject:`Aggiornamento`, email_body:`Imprevisto ora, ti aggiorno entro sera.` }
  ]};
}

function pick(obj, path, d=null){
  try{ return path.split('.').reduce((a,k)=>(a&&a[k]!=null?a[k]:null), obj) ?? d; }catch{ return d; }
}

async function getPhoneCandidates(session, paymentIntent){
  const out = new Set();

  const sPhone = pick(session, 'customer_details.phone');
  if (sPhone) out.add(sPhone);

  const chPhone = pick(paymentIntent, 'charges.data.0.billing_details.phone');
  if (chPhone) out.add(chPhone);

  const customFields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  customFields.forEach(cf=>{
    if ((cf?.key||'').toLowerCase()==='phone' && cf?.text?.value) out.add(cf.text.value);
  });

  const customerId = session.customer || paymentIntent?.customer;
  if (customerId){
    try{
      const customer = await stripe.customers.retrieve(customerId);
      if (customer?.phone) out.add(customer.phone);
      if (customer?.metadata?.phone) out.add(customer.metadata.phone);
    }catch{}
  }

  return Array.from(out).filter(Boolean);
}

exports.handler = async (event) => {
  // Verifica firma webhook
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) return http(400, { error:'missing_signature' });

  let stripeEvent;
  try{
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(err){
    return http(400, { error:'invalid_signature' });
  }

  if (stripeEvent.type !== 'checkout.session.completed')
    return http(200, { received:true, ignored: stripeEvent.type });

  const session = stripeEvent.data.object;
  if (!session || (session.mode!=='payment' && session.mode!=='subscription'))
    return http(200, { received:true, ignored:'not_payment_or_subscription' });

  // PI può NON esserci (es. totale €0 con coupon 100%)
  const piId = session.payment_intent || null;
  let pi = null;
  if (piId) {
    try { pi = await stripe.paymentIntents.retrieve(piId); } catch {}
  }

  // Email cliente
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  if (!email) return http(200, { ok:true, ignored:'missing_email' });

  // Line items -> minuti & tag prodotto
  let minutes = 0, productTag = '';
  try{
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit:100, expand:['data.price.product'] });
    for (const li of items.data){
      const priceId = li?.price?.id;
      const sku = li?.price?.lookup_key;
      const rule = RULES_BY_PRICE[priceId] || (sku ? RULES_BY_SKU[sku] : null) || {};
      minutes += (Number(rule.minutes||0) * (li.quantity||1)) || 0;
      if (!productTag && rule.excuse) productTag = rule.excuse;
    }
  }catch{}

  // Contesto da custom_fields
  let context = '';
  const cfs = Array.isArray(session?.custom_fields)? session.custom_fields : [];
  for (const cf of cfs){
    if ((cf?.key||'').toLowerCase()==='need' && cf?.text?.value) context = String(cf.text.value||'').trim();
  }

  // Genera scuse (3 varianti)
  const ai = await generateExcusesAI(context, productTag);
  const variants = Array.isArray(ai?.variants) ? ai.variants.slice(0,3) : [];

  // Email
  await sendEmail(email, minutes, variants);

  // WhatsApp (best-effort)
  const phones = await getPhoneCandidates(session, pi);
  let waStatus = 'no_phone';
  if (phones.length){
    const text = [
      'La tua Scusa (3 varianti):',
      ...variants.map((v,i)=>`${i+1}) ${v.whatsapp_text || v.sms || v.email_body || ''}`),
      '',
      `(+${minutes} min accreditati su COLPA MIA)`
    ].join('\n');
    for (const p of phones){
      const r = await sendWhatsApp(p, text);
      if (r.ok){ waStatus='sent'; break; } else waStatus='error';
    }
  }

  // Aggiorna saldo su Customer (somma minuti)
  try{
    if (session.customer && minutes>0){
      let cur = 0;
      try{
        const cust = await stripe.customers.retrieve(session.customer);
        cur = Number(cust?.metadata?.cm_minutes_total || 0);
      }catch{}
      await stripe.customers.update(session.customer, {
        metadata: {
          cm_minutes_total: String(cur + minutes),
          cm_last_session: session.id
        }
      });
    }
  }catch{}

  // Metadati sul PI (se esiste)
  if (piId){
    try{
      await stripe.paymentIntents.update(piId, {
        metadata: {
          ...(pi?.metadata||{}),
          colpamiaCredited: 'true',
          colpamiaEmailSent: 'true',
          colpamiaWhatsAppTried: String(!!phones.length),
          colpamiaWaStatus: waStatus,
          minutesCredited: String(minutes),
          excusesCount: String(variants.length || 0)
        }
      });
    }catch{}
  }

  return http(200, { ok:true, minutes, email, waStatus, zeroAmount: session.amount_total===0 });
};
