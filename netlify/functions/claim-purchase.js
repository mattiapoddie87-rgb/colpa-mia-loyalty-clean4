// netlify/functions/claim-purchase.js
const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const resend = new Resend(process.env.RESEND_API_KEY || '');
const MAIL_FROM = process.env.RESEND_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken) ? require('twilio')(twilioSid, twilioToken) : null;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b)});

function readJsonEnv(k){ try{ return JSON.parse(process.env[k]||'{}'); }catch{ return {}; } }
const PRICE_RULES = readJsonEnv('PRICE_RULES_JSON'); // { price_xxx: { minutes, excuse } }
const MAP_BY_SKU   = readJsonEnv('PRICE_RULES_BY_SKU_JSON') || readJsonEnv('SKU_RULES_JSON') || {}; // opzionale

const onlyDigits = s => String(s||'').replace(/[^\d]/g,'');
const isE164 = s => /^\+\d{6,15}$/.test(String(s||''));
function asWhatsApp(toRaw){
  let s = String(toRaw||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(s)) return s;
  if (isE164(s)) return `whatsapp:${s}`;
  let d = onlyDigits(s);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = (process.env.DEFAULT_COUNTRY_CODE || '+39').replace('+','');
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}

async function generateExcusesAI(context, productTag){
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!/^sk-/.test(apiKey)) {
    const v = [
      `Mi è entrato un imprevisto serio, sto riorganizzando e ti aggiorno entro sera.`,
      `È saltata fuori una cosa urgente: sistemo e ti scrivo appena ho un orario affidabile.`,
      `Situazione imprevista, non voglio lasciarti in sospeso: ti mando un nuovo ETA tra poco.`
    ];
    return { variants: v.map(t=>({sms:t, whatsapp_text:t, email_subject:'Aggiornamento', email_body:t})) };
  }
  try{
    const r = await fetch(`${process.env.SITE_URL || 'https://colpamia.com'}/.netlify/functions/ai-excuse`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ need:context||productTag||'ritardo', style:'neutro', persona:productTag||'generico', locale:'it-IT', maxLen:300 })
    });
    const data = await r.json().catch(()=> ({}));
    if (Array.isArray(data?.variants) && data.variants.length) return data;
  }catch{}
  return { variants: [
    { sms:`Imprevisto ora, ti aggiorno entro sera.`, whatsapp_text:`Imprevisto ora, ti aggiorno entro sera.`, email_subject:`Aggiornamento`, email_body:`Imprevisto ora, ti aggiorno entro sera.` }
  ]};
}

async function sendEmail(to, minutes, variants){
  if (!resend || !to) return;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v=>`<p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px;">${v.whatsapp_text||v.sms||v.email_body||''}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
    </div>`;
  try{
    await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
  }catch{}
}

async function sendWhatsApp(toRaw, text){
  if (!twilio || !twilioFromWa || !toRaw) return { ok:false, reason:'twilio_not_configured' };
  try{
    await twilio.messages.create({ from: twilioFromWa, to: asWhatsApp(toRaw), body: text });
    return { ok:true };
  }catch(e){ return { ok:false, reason: e?.message || 'wa_error' }; }
}

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{error:'method_not_allowed'});

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }
  const sessionId = String(body.session_id||body.sessionId||'').trim();
  const emailFallback = String(body.email||'').trim();
  const phoneFallback = String(body.phone||'').trim();
  if (!sessionId) return j(400,{error:'missing_session_id'});

  try{
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price.product','customer']
    });

    // email
    const email = (session.customer_details?.email || session.customer_email || emailFallback || '').toLowerCase();
    if (!email) return j(400,{error:'missing_email'});

    // minuti dai line items
    const items = session?.line_items?.data || [];
    let minutes = 0, productTag='';
    for (const li of items){
      const priceId = li?.price?.id;
      const rule = PRICE_RULES[priceId] || {};
      minutes += (Number(rule.minutes||0) * (li.quantity||1)) || 0;
      if (!productTag && rule.excuse) productTag = rule.excuse;
      // opzionale via SKU
      const sku = li?.price?.lookup_key;
      if (!rule && sku && MAP_BY_SKU[sku]) {
        minutes += (Number(MAP_BY_SKU[sku].minutes||0) * (li.quantity||1)) || 0;
        if (!productTag && MAP_BY_SKU[sku].excuse) productTag = MAP_BY_SKU[sku].excuse;
      }
    }

    // contesto da custom_fields
    let context = '';
    const cfs = Array.isArray(session?.custom_fields)? session.custom_fields : [];
    for (const cf of cfs) if ((cf.key||'').toLowerCase()==='need' && cf?.text?.value) context = String(cf.text.value||'').trim();

    // genera scuse
    const ai = await generateExcusesAI(context, productTag);
    const variants = Array.isArray(ai?.variants)? ai.variants.slice(0,3) : [];

    // invia email
    await sendEmail(email, minutes, variants);

    // tenta WhatsApp
    const phoneCandidates = [
      session.customer_details?.phone,
      phoneFallback,
      ...cfs.filter(x=>(x.key||'').toLowerCase()==='phone' && x?.text?.value).map(x=>x.text.value)
    ].filter(Boolean);

    let waStatus = 'no_phone';
    if (phoneCandidates.length){
      const text = [
        'La tua Scusa (3 varianti):',
        ...variants.map((v,i)=>`${i+1}) ${v.whatsapp_text || v.sms || v.email_body || ''}`),
        '',
        `(+${minutes} min accreditati su COLPA MIA)`
      ].join('\n');
      for (const p of phoneCandidates){
        const r = await sendWhatsApp(p, text);
        if (r.ok){ waStatus='sent'; break; } else waStatus='error';
      }
    }

    // aggiorna saldo su Customer
    const customerId = session.customer;
    if (customerId && minutes>0){
      let cur=0;
      try{
        const cust = await stripe.customers.retrieve(customerId);
        cur = Number(cust?.metadata?.cm_minutes_total||0);
      }catch{}
      try{
        await stripe.customers.update(customerId, {
          metadata: { cm_minutes_total: String(cur + minutes), cm_last_session: session.id }
        });
      }catch{}
    }

    return j(200,{ ok:true, minutes, email, waStatus, zeroAmount: session.amount_total===0 });

  }catch(err){
    return j(400,{ error: String(err?.message||'claim_error') });
  }
};
