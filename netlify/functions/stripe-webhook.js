// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = new Resend((process.env.RESEND_API_KEY || '').trim());
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid   = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken) ? require('twilio')(twilioSid, twilioToken) : null;

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
const PRICE_RULES = (()=>{ try{ return JSON.parse(process.env.PRICE_RULES_JSON||'{}'); }catch{ return {}; }})();

const j = (s,b) => ({ statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) });
const pick = (x,k,d=null)=>{ try{ return k.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } };
const isE164 = s => /^\+\d{6,15}$/.test(String(s||''));
const asWhatsApp = s => /^whatsapp:/.test(s) ? s : `whatsapp:${isE164(s) ? s : s.replace(/^\+?/,'+')}`;

// ---- AI excuses via function
async function generateExcusesAI(context, productTag){
  const payload = { need: context||productTag||'ritardo', style:'neutro', persona:productTag||'generico', locale:'it-IT', maxLen:300 };
  try{
    const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const data = await r.json().catch(()=> ({}));
    const v = (data?.variants || []).map(x => String(x?.whatsapp_text || x?.sms || '').trim()).filter(Boolean);
    if (v.length) return { short: v[0], variants: v.slice(0,3) };
  }catch{}
  // fallback
  return { short:`Imprevisto ora, riorganizzo e ti aggiorno a breve.`, variants:[
    `Imprevisto ora, riorganizzo e ti aggiorno a breve.`,
    `È saltata fuori una cosa urgente: ti scrivo entro poco con un orario chiaro.`,
    `Sto gestendo un imprevisto, preferisco non promettere tempi: ti aggiorno entro sera.`
  ]};
}

// ---- Email
async function sendEmail(to, minutes, excuses){
  if (!resend.apiKey) return;
  const { variants=[] } = excuses || {};
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <h2 style="margin:0 0 12px">La tua scusa</h2>
    ${variants.map(v=>`<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${v}</p>`).join('')}
    <p style="margin-top:12px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
  </div>`;
  await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
}

// ---- WhatsApp
async function sendWhatsApp(to, message){
  if (!twilio || !twilioFromWa) return { ok:false, reason:'twilio_not_configured' };
  try{
    await twilio.messages.create({ from: twilioFromWa, to: asWhatsApp(to), body: message });
    return { ok:true };
  }catch(err){ return { ok:false, reason:String(err?.message||'wa_error') }; }
}

// ---- CREDITI: salva su Customer.metadata (cm_minutes / cm_points)
async function creditMinutes(email, addMinutes, maybePhone){
  // 1) trova/crea customer
  const list = await stripe.customers.list({ email, limit: 5 });
  let customer = list.data.find(c => (c.email||'').toLowerCase() === email) || list.data[0] || null;
  if (!customer) {
    customer = await stripe.customers.create({ email });
  }

  // 2) accumula metadata
  const md = customer.metadata || {};
  const prevMin = parseInt(md.cm_minutes || '0', 10) || 0;
  const prevPts = parseInt(md.cm_points  || '0', 10) || 0;

  const minutes = prevMin + (addMinutes||0);
  const points  = prevPts + Math.max(1, Math.round((addMinutes||0)/10)*10); // es. 10 min ⇒ +10 pt

  const update = { metadata: { ...md, cm_minutes:String(minutes), cm_points:String(points) } };
  if (maybePhone && !customer.phone && isE164(maybePhone)) update.phone = maybePhone;

  await stripe.customers.update(customer.id, update);
  return { customerId: customer.id, minutes, points };
}

// ---- Phone candidates
function getPhones(session, paymentIntent){
  const out = new Set();
  const sPhone = pick(session,'customer_details.phone'); if (sPhone) out.add(sPhone);
  const chPhone = pick(paymentIntent,'charges.data.0.billing_details.phone'); if (chPhone) out.add(chPhone);
  const cfs = Array.isArray(session?.custom_fields)? session.custom_fields : [];
  for (const cf of cfs){ if (cf?.key?.toLowerCase()==='phone' && cf?.text?.value) out.add(cf.text.value); }
  return Array.from(out);
}

exports.handler = async (event) => {
  try{
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) return j(400,{ error:'missing_signature_or_secret' });

    const ev = stripe.webhooks.constructEvent(event.body, sig, secret);
    if (ev.type !== 'checkout.session.completed') return j(200,{ received:true, ignored: ev.type });

    const session = ev.data.object;
    if (session.mode !== 'payment') return j(200,{ received:true, ignored:'not_payment' });

    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return j(200,{ received:true, ignored:'missing_email' });

    const piId = String(session.payment_intent||'');
    let pi = piId ? await stripe.paymentIntents.retrieve(piId) : null;
    if (pi?.metadata?.colpamiaCredited === 'true') return j(200,{ ok:true, already:true });

    // ---- Calcolo minuti dai line-items
    const li = await stripe.checkout.sessions.listLineItems(session.id, { limit:100, expand:['data.price.product'] });
    let minutes = 0; let productTag = '';
    for (const item of li.data){
      const priceId = item?.price?.id;
      const lookup  = item?.price?.lookup_key;
      const rule = PRICE_RULES[priceId] || PRICE_RULES[lookup] || {};
      const add = (Number(rule.minutes)||0) * (item.quantity||1);
      minutes += add;
      if (!productTag && rule.excuse) productTag = rule.excuse;
    }

    // ---- Contesto dal custom field "need"
    let context = '';
    const cfs = Array.isArray(session?.custom_fields)? session.custom_fields : [];
    for (const cf of cfs){ if (cf?.key?.toLowerCase()==='need' && cf?.text?.value) context = String(cf.text.value||'').trim(); }

    // ---- Genera scuse
    const excuses = await generateExcusesAI(context, productTag);

    // ---- Accredita e salva sul Customer
    const phones = getPhones(session, pi||{});
    const mainPhone = phones.find(p => isE164(p)) || null;
    const { minutes: newMinutes, points: newPoints } = await creditMinutes(email, minutes, mainPhone);

    // ---- Email
    try{ await sendEmail(email, minutes, excuses); }catch{}

    // ---- WhatsApp (best-effort)
    if (mainPhone && excuses?.variants?.length){
      const waText = [
        'La tua Scusa (3 varianti):',
        ...excuses.variants.map((v,i)=>`${i+1}) ${v}`),
        '',
        `(+${minutes} min accreditati su COLPA MIA)`
      ].join('\n');
      try{ await sendWhatsApp(mainPhone, waText); }catch{}
    }

    // ---- Marca PI come processato
    if (piId){
      await stripe.paymentIntents.update(piId, {
        metadata: {
          ...(pi?.metadata||{}),
          colpamiaCredited: 'true',
          minutesCredited: String(minutes),
          walletMinutesAfter: String(newMinutes),
          walletPointsAfter: String(newPoints),
        }
      });
    }

    return j(200,{ ok:true, minutesCredited: minutes, email, walletMinutes: newMinutes, walletPoints: newPoints });
  }catch(err){
    return j(500,{ error:String(err?.message||'webhook_error') });
  }
};
