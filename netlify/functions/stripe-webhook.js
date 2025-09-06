 const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const MAIL_FROM = process.env.RESEND_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid   = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || '';
const twilio = (twilioSid && twilioToken && twilioFromWa) ? require('twilio')(twilioSid, twilioToken) : null;

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' };
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}};

function onlyDigits(s){ return String(s||'').replace(/[^\d]/g,''); }
function isE164(s){ return /^\+\d{6,15}$/.test(String(s||'')); }
function asWhatsApp(s, cc=(process.env.DEFAULT_COUNTRY_CODE||'+39')){
  let v=String(s||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(v)) return v;
  if (isE164(v)) return `whatsapp:${v}`;
  let d=onlyDigits(v); if (d.startsWith('00')) d=d.slice(2);
  cc=cc.replace('+',''); if (!d.startsWith(cc)) d=cc+d;
  return `whatsapp:+${d}`;
}

function parseRules(){ try{return JSON.parse(process.env.PRICE_RULES_JSON||'{}');}catch{return{};} }

// -------- AI: garantisci SEMPRE 3 varianti
async function callAI(need, persona, style){
  const body = { need, style, persona: persona||'generico', locale:'it-IT', maxLen:300 };
  const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`,{
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  const data = await r.json().catch(()=>null);
  return (data && Array.isArray(data.variants)) ? data.variants : [];
}
function cleanVariant(v){
  const txt = String(v?.whatsapp_text || v?.sms || '').trim();
  return txt ? { whatsapp_text: txt } : null;
}
function localVariations(base){
  const b = String(base||'').trim();
  const v1 = b.replace('Imprevisto ora','È saltata fuori una cosa urgente');
  const v2 = b.replace('ti aggiorno entro','ti scrivo entro');
  return [{whatsapp_text:b},{whatsapp_text:v1},{whatsapp_text:v2}];
}
async function makeExcuses(need, persona){
  const styles = ['neutro','executive','soft','tecnico'];
  const bag = new Map();

  // 1) un colpo “larghezza”
  for (const s of styles){
    try{
      const vs = await callAI(need||'ritardo', persona, s);
      for (const v of vs){
        const c = cleanVariant(v); if (!c) continue;
        const k = c.whatsapp_text.toLowerCase();
        if (!bag.has(k)) bag.set(k,c);
        if (bag.size>=3) break;
      }
      if (bag.size>=3) break;
    }catch{}
  }
  // 2) se ancora <3, crea variazioni locali dal primo testo
  if (bag.size===0){
    localVariations('Imprevisto ora, sto riorganizzando. Ti aggiorno entro sera.')
      .forEach(v=>bag.set(v.whatsapp_text.toLowerCase(), v));
  } else if (bag.size<3){
    const first = [...bag.values()][0].whatsapp_text;
    for (const v of localVariations(first)){
      const k=v.whatsapp_text.toLowerCase(); if (!bag.has(k)) bag.set(k,v);
      if (bag.size>=3) break;
    }
  }
  return [...bag.values()].slice(0,3);
}

// ------ minuti/“persona”
async function computeMinutesAndPersona(session){
  const rules = parseRules();
  let minutes=0, persona='';
  const items = await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));

  for (const li of (items.data||[])){
    const pid = li?.price?.id, qty = li?.quantity||1;
    if (pid && rules[pid]){ minutes += Number(rules[pid].minutes||0)*qty; if(!persona && rules[pid].excuse) persona = String(rules[pid].excuse); }
  }
  if (minutes<=0){
    for (const li of (items.data||[])){
      const qty = li?.quantity||1;
      const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
      const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
      minutes += (m1||m2)*qty;
      if (!persona) persona = pick(li,'price.metadata.excuse','') || pick(li,'price.product.metadata.excuse','') || '';
    }
  }
  if (minutes<=0) minutes=10;
  return { minutes, persona: persona||'generico' };
}

async function sendEmail(to, minutes, variants){
  if (!resend) return;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <h2 style="margin:0 0 12px">La tua scusa</h2>
    ${variants.map(v=>`<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${v.whatsapp_text.replace(/\n/g,'<br>')}</p>`).join('')}
    <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
  </div>`;
  await resend.emails.send({ from: MAIL_FROM, to, subject:'La tua scusa — Colpa Mia', html });
}

async function sendWhatsApp(toRaw, text, piId){
  if (!twilio) return { ok:false, reason:'twilio_not_configured' };
  try{
    await twilio.messages.create({ from: twilioFromWa, to: asWhatsApp(toRaw), body: text });
    return { ok:true };
  }catch(e){
    try{ await stripe.paymentIntents.update(piId,{ metadata:{ colpamiaWaError:String(e?.message||'wa_error') }});}catch{}
    return { ok:false, reason:String(e?.message||'wa_error') };
  }
}

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  if (event.httpMethod!=='POST')   return j(405,{error:'method_not_allowed'});

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) return j(400,{error:'missing_signature'});

  let se; try{ se=stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch{ return j(400,{error:'bad_signature'}); }

  if (se.type!=='checkout.session.completed') return j(200,{received:true,ignored:se.type});
  const session = se.data.object;
  if (session.mode!=='payment') return j(200,{received:true,ignored:'not_payment'});

  const email = (pick(session,'customer_details.email','') || session.customer_email || '').toLowerCase();
  const need = (Array.isArray(session.custom_fields)?session.custom_fields:[])
                .find(cf=>(cf?.key||'').toLowerCase()==='need')?.text?.value || '';

  const piId = String(session.payment_intent||'');
  if (!piId) return j(400,{error:'missing_payment_intent'});

  let pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.metadata?.colpamiaCredited==='true') return j(200,{ok:true,already:true});

  const { minutes, persona } = await computeMinutesAndPersona(session);
  const variants = await makeExcuses(need, persona);

  if (email){ try{ await sendEmail(email, minutes, variants); }catch{} }

  const phones = new Set();
  const sPhone = pick(session,'customer_details.phone',''); if (sPhone) phones.add(sPhone);
  const chPhone = pick(pi,'charges.data.0.billing_details.phone',''); if (chPhone) phones.add(chPhone);
  if (session.customer){ try{ const c=await stripe.customers.retrieve(session.customer); if(c?.phone) phones.add(c.phone); if(c?.metadata?.phone) phones.add(c.metadata.phone);}catch{} }

  const waText = ['La tua Scusa (3 varianti):',...variants.map((v,i)=>`${i+1}) ${v.whatsapp_text}`),'',`(+${minutes} min accreditati su COLPA MIA)`].join('\n');
  let waStatus='no_phone';
  for (const p of phones){ const r=await sendWhatsApp(p, waText, piId); if (r.ok){ waStatus='sent'; break; } else waStatus='error'; }

  try{
    pi = await stripe.paymentIntents.update(piId,{
      metadata:{
        ...pi.metadata,
        colpamiaCredited:'true',
        colpamiaEmailSent: email ? 'true':'false',
        colpamiaWaTried: String(phones.size>0),
        colpamiaWaStatus: waStatus,
        minutesCredited: String(minutes),
        excusesCount: '3',
        customerEmail: email || (pick(pi,'charges.data.0.billing_details.email','')||'')
      }
    });
  }catch{}

  return j(200,{ok:true, minutes, email, waStatus});
};
      
