```js
// netlify/functions/stripe-webhook.js
// Webhook Stripe: accredita minuti, invia email e (se disponibile) WhatsApp.
// Con AI per generare 3 varianti di scuse, timeout, e guard-rail di sicurezza.

async function generateExcusesAI(context, productTag){
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!/^sk-/.test(apiKey)) {
    // Fallback se manca la chiave OpenAI
    return {
      short: 'Imprevisto ora, riorganizzo e ti aggiorno a breve.',
      variants: [
        'Imprevisto ora, riorganizzo e ti aggiorno a breve.',
        'È saltata fuori una cosa urgente: ti scrivo entro poco con un orario chiaro.',
        'Sto gestendo un imprevisto, preferisco non promettere tempi: ti aggiorno entro sera.'
      ]
    };
  }

  const payload = {
    need: context || productTag || 'ritardo',
    style: 'neutro',
    persona: productTag || 'generico',
    locale: 'it-IT',
    maxLen: 300
  };

  try{
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), 4500); // hard cap 4.5s
    const r = await fetch(`${process.env.SITE_URL || 'https://colpamia.com'}/.netlify/functions/ai-excuse`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    clearTimeout(to);
    const data = await r.json().catch(()=> ({}));
    const v = (data?.variants || [])
      .map(x => String(x?.whatsapp_text || x?.sms || '').trim())
      .filter(Boolean);
    if (v.length) return { short: v[0], variants: v.slice(0,3) };
  }catch{/* noop */}

  // Fallback duro se l’HTTP fallisce o timeout
  return {
    short: 'Imprevisto ora, riorganizzo e ti aggiorno a breve.',
    variants: [
      'Imprevisto ora, riorganizzo e ti aggiorno a breve.',
      'È saltata fuori una cosa urgente: ti scrivo entro poco con un orario chiaro.',
      'Sto gestendo un imprevisto, preferisco non promettere tempi: ti aggiorno entro sera.'
    ]
  };
}

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886 (sandbox)
const defaultCC = (process.env.DEFAULT_COUNTRY_CODE || '+39').trim();
const twilio = (twilioSid && twilioToken ? require('twilio')(twilioSid, twilioToken) : null);

function readJsonEnv(key){ try{ return JSON.parse(process.env[key]||'{}'); }catch{ return {}; } }
const PRICE_RULES = readJsonEnv('PRICE_RULES_JSON'); // { price_xxx: { minutes, excuse } }

function httpResp(s,b){ return { statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }; }
function pick(x,k,d=null){ try{ return k.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } }

// -------- phone helpers
function onlyDigits(s){ return String(s||'').replace(/[^\d]/g,''); }
function isE164(s){ return /^(\+)\d{6,15}$/.test(String(s||'')); }
function asWhatsApp(toRaw){
  let to = String(toRaw||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(to)) return to;
  if (isE164(to)) return `whatsapp:${to}`;
  let d = onlyDigits(to);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = defaultCC.replace('+','');
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}

// Recupera possibili telefoni da Session/PI e dal Customer
async function getPhoneCandidates(session, paymentIntent){
  const out = new Set();

  const sPhone = pick(session, 'customer_details.phone');
  if (sPhone) out.add(sPhone);

  const chPhone = pick(paymentIntent, 'charges.data.0.billing_details.phone');
  if (chPhone) out.add(chPhone);

  const customFields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  customFields.forEach(cf => {
    if (cf?.key?.toLowerCase()==='phone' && cf?.text?.value) out.add(cf.text.value);
  });

  // Fallback: Customer
  const customerId = session.customer || paymentIntent.customer;
  if (customerId){
    try{
      const customer = await stripe.customers.retrieve(customerId);
      if (customer?.phone) out.add(customer.phone);
      if (customer?.metadata?.phone) out.add(customer.metadata.phone);
    }catch{/* noop */}
  }
  return Array.from(out);
}

// ------ email
async function sendEmail(to, minutes, excuses){
  const { variants } = excuses;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v=>`<p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px;">${v}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
      <p style="font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
    </div>`;
  await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
}

// ------ whatsapp
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
    }catch{/* noop */}
    return { ok:false, reason: err?.message || 'wa_error' };
  }
}

// ------ accredito (placeholder)
async function creditMinutes(email, minutes){ return true; }

// ------ handler
exports.handler = async (event)=>{
  try{
    // Guard-rail env
    if (!/^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET||'')) {
      return httpResp(500,{ error:'server_misconfigured: STRIPE_WEBHOOK_SECRET invalid' });
    }
    if (!/^sk_(live|test)_/.test(process.env.STRIPE_SECRET_KEY||'')) {
      return httpResp(500,{ error:'server_misconfigured: STRIPE_SECRET_KEY invalid' });
    }

    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return httpResp(400,{ error:'missing signature' });

    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeEvent = stripe.webhooks.constructEvent(event.body, sig, whSecret);

    if (stripeEvent.type !== 'checkout.session.completed')
      return httpResp(200,{ received:true, ignored: stripeEvent.type });

    const session = stripeEvent.data.object;
    if (session.mode !== 'payment') return httpResp(200,{ received:true, ignored:'not_payment' });

    const piId = String(session.payment_intent||'');
    if (!piId) return httpResp(400,{ error:'missing payment_intent' });

    let pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.colpamiaCredited === 'true') return httpResp(200,{ ok:true, already:true });

    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return httpResp(400,{ error:'missing email' });

    const items = await stripe.checkout.sessions.listLineItems(session.id,{ limit:100, expand:['data.price.product'] });
    let minutes = 0; let productTag = '';
    for (const li of items.data){
      const rule = PRICE_RULES[li?.price?.id] || {};
      minutes += (Number(rule.minutes||0) * (li.quantity||1)) || 0;
      if (!productTag && rule.excuse) productTag = rule.excuse;
    }
    if (minutes <= 0) return httpResp(200,{ ok:true, ignored:'no_minutes' });

    // Contesto da custom fields
    let context = '';
    const cfs = Array.isArray(session?.custom_fields)? session.custom_fields : [];
    for (const cf of cfs){
      if (cf?.key?.toLowerCase() === 'need' && cf?.text?.value) context = String(cf.text.value||'').trim();
    }

    // Genera scuse via AI (con timeout/fallback)
    const excuses = await generateExcusesAI(context, productTag);

    // Accredito + comunicazioni
    await creditMinutes(email, minutes);
    await sendEmail(email, minutes, excuses);

    // WhatsApp
    const phoneCandidates = await getPhoneCandidates(session, pi);
    let waStatus = 'no_phone';

    if (phoneCandidates.length){
      const waText = [
        'La tua Scusa (3 varianti):',
        ...excuses.variants.map((v, i) => `${i + 1}) ${v}`),
        '',
        `(+${minutes} min accreditati su COLPA MIA)`
      ].join('\n');

      for (const raw of phoneCandidates){
        const res = await sendWhatsApp(raw, waText, piId);
        if (res.ok){ waStatus = 'sent'; break; }
        else { waStatus = 'error'; } // dettaglio in colpamiaWaError sui metadata del PI
      }
    }

    // metadati PI aggiornati
    pi = await stripe.paymentIntents.update(piId, {
      metadata: {
        ...(pi.metadata||{}),
        colpamiaCredited: 'true',
        colpamiaEmailSent: 'true',
        colpamiaWhatsAppTried: String(!!phoneCandidates.length),
        colpamiaWaStatus: waStatus,
        minutesCredited: String(minutes),
        excusesCount: '3'
      }
    });

    return httpResp(200,{ ok:true, minutes, email, waStatus });
  }catch(err){
    return httpResp(500,{ error: err?.message || 'webhook_error' });
  }
};
```
