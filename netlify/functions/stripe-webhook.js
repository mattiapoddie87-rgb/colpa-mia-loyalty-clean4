// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const MAIL_FROM = process.env.RESEND_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid   = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken && twilioFromWa) ? require('twilio')(twilioSid, twilioToken) : null;

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' };
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

function pick(x,p,d=null){try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}}
function onlyDigits(s){ return String(s||'').replace(/[^\d]/g,''); }
function isE164(s){ return /^\+\d{6,15}$/.test(String(s||'')); }
function asWhatsApp(s, cc=(process.env.DEFAULT_COUNTRY_CODE||'+39')) {
  let v = String(s||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(v)) return v;
  if (isE164(v)) return `whatsapp:${v}`;
  let d = onlyDigits(v); if (d.startsWith('00')) d=d.slice(2);
  cc = cc.replace('+',''); if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}

// === AI scuse via Netlify function (varia + robuste)
async function makeExcuses(context, persona, maxLen=300){
  try{
    const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ need:context||'ritardo', style:'neutro', persona: persona||'generico', locale:'it-IT', maxLen })
    });
    const data = await r.json().catch(()=>null);
    const arr = (data && Array.isArray(data.variants)) ? data.variants.slice(0,3) : [];
    if (arr.length) return arr;
  }catch{}
  // fallback di emergenza (mai a secco)
  return [
    { whatsapp_text:`Imprevisto ora, sto riorganizzando. Ti aggiorno entro sera.` },
    { whatsapp_text:`Sto chiudendo un’urgenza e ritardo un po’. Ti scrivo entro le 18 con ETA affidabile.` },
    { whatsapp_text:`Situazione imprevista: non voglio darti buca. A breve ti mando un nuovo slot.` }
  ];
}

function parseRules(){
  try{ return JSON.parse(process.env.PRICE_RULES_JSON||'{}'); }catch{ return {}; }
}

async function computeMinutesAndPersona(session){
  // 1) prova con mappa ENV (price_id -> minutes/excuse)
  const rules = parseRules();
  let minutes = 0, persona = '';
  const items = await stripe.checkout.sessions.listLineItems(session.id,{limit:100, expand:['data.price.product']}).catch(()=>({data:[]}));

  for (const li of (items.data||[])){
    const pid = li?.price?.id;
    const qty = li?.quantity || 1;
    if (pid && rules[pid]){
      minutes += Number(rules[pid].minutes||0) * qty;
      if (!persona && rules[pid].excuse) persona = String(rules[pid].excuse);
    }
  }

  // 2) fallback: usa metadata su price / product (minutes, excuse)
  if (minutes<=0){
    for (const li of (items.data||[])){
      const qty = li?.quantity || 1;
      const m1 = Number(pick(li,'price.metadata.minutes',0)) || 0;
      const m2 = Number(pick(li,'price.product.metadata.minutes',0)) || 0;
      const m = (m1||m2) * qty;
      minutes += m;
      if (!persona){
        persona = pick(li,'price.metadata.excuse','') || pick(li,'price.product.metadata.excuse','') || '';
      }
    }
  }

  // 3) ultimo paracadute: se ancora 0, assegna 10 così non resta a zero
  if (minutes<=0) minutes = 10;
  return { minutes, persona: (persona||'generico') };
}

async function sendEmail(to, minutes, variants){
  if (!resend) return;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <h2 style="margin:0 0 12px">La tua scusa</h2>
    ${variants.map(v=>`<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${(v.whatsapp_text||v.sms||'').replace(/\n/g,'<br>')}</p>`).join('')}
    <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
  </div>`;
  await resend.emails.send({ from: MAIL_FROM, to, subject:'La tua scusa — Colpa Mia', html });
}

async function sendWhatsApp(toRaw, text, piId){
  if (!twilio) return {ok:false, reason:'twilio_not_configured'};
  try{
    await twilio.messages.create({ from: twilioFromWa, to: asWhatsApp(toRaw), body: text });
    return {ok:true};
  }catch(e){
    try{
      await stripe.paymentIntents.update(piId,{ metadata:{ colpamiaWaError: String(e?.message||'wa_error') }});
    }catch{}
    return {ok:false, reason:String(e?.message||'wa_error')};
  }
}

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  if (event.httpMethod!=='POST')   return j(405,{error:'method_not_allowed'});

  let sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) return j(400,{error:'missing_signature'});

  let stripeEvent;
  try{
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(e){
    return j(400,{error:'bad_signature'});
  }

  if (stripeEvent.type !== 'checkout.session.completed') return j(200,{received:true,ignored:stripeEvent.type});

  const session = stripeEvent.data.object;
  if (session.mode!=='payment') return j(200,{received:true,ignored:'not_payment'});

  const email = (pick(session,'customer_details.email','') || session.customer_email || '').toLowerCase();
  const need  = (Array.isArray(session.custom_fields) ? session.custom_fields : [])
                  .find(cf => (cf?.key||'').toLowerCase()==='need')?.text?.value || '';

  const piId = String(session.payment_intent||'');
  if (!piId) return j(400,{error:'missing_payment_intent'});

  let pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.metadata?.colpamiaCredited==='true') return j(200,{ok:true,already:true});

  // minuti + persona robusti (ENV rules -> price.metadata -> default)
  const { minutes, persona } = await computeMinutesAndPersona(session);
  const variants = await makeExcuses(need, persona, 300);

  // email
  if (email) { try{ await sendEmail(email, minutes, variants);}catch{} }

  // whatsapp (first phone we can find)
  let waCandidates = new Set();
  const sPhone = pick(session,'customer_details.phone',''); if (sPhone) waCandidates.add(sPhone);
  const chPhone = pick(pi,'charges.data.0.billing_details.phone',''); if (chPhone) waCandidates.add(chPhone);
  if (session.customer){
    try{
      const c = await stripe.customers.retrieve(session.customer);
      if (c?.phone) waCandidates.add(c.phone);
      if (c?.metadata?.phone) waCandidates.add(c.metadata.phone);
    }catch{}
  }
  const waText = [
    'La tua Scusa (3 varianti):',
    ...variants.map((v,i)=>`${i+1}) ${v.whatsapp_text || v.sms || ''}`),
    '',
    `(+${minutes} min accreditati su COLPA MIA)`
  ].join('\n');
  let waStatus='no_phone';
  for (const p of waCandidates){
    const r = await sendWhatsApp(p, waText, piId);
    if (r.ok){ waStatus='sent'; break; }
    else waStatus='error';
  }

  // metadata PI finali (wallet leggerà qui)
  try{
    pi = await stripe.paymentIntents.update(piId,{
      metadata:{
        ...pi.metadata,
        colpamiaCredited:'true',
        colpamiaEmailSent: email ? 'true':'false',
        colpamiaWaTried: String(waCandidates.size>0),
        colpamiaWaStatus: waStatus,
        minutesCredited: String(minutes),
        excusesCount: String(variants.length),
        customerEmail: email || (pick(pi,'charges.data.0.billing_details.email','')||'')
      }
    });
  }catch{}

  return j(200,{ok:true, minutes, email, waStatus});
};
