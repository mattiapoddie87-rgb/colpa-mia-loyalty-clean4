// netlify/functions/stripe-webhook.js
// Checkout → 3 scuse → Email (Resend, mittente @colpamia.com) → WhatsApp (Twilio) → metadata PI

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const fetchFn = (...a) => fetch(...a);

// === ENV ===
const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/, '');
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN  || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA     || '').trim();

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body: JSON.stringify(b) });

// === Utils ===
const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } };
const parseRules=()=>{ try{ return JSON.parse(process.env.PRICE_RULES_JSON||'{}'); }catch{ return {}; } };

function skuToKind(sku){
  const s=String(sku||'').toUpperCase();
  if (s.includes('RIUNIONE')) return 'riunione';
  if (s.includes('TRAFFICO')) return 'traffico';
  if (s.includes('DELUXE'))   return 'deluxe';
  if (s.includes('TRIPLA'))   return 'tripla';
  if (s.includes('CONS')||s.includes('CONN')) return 'connessione';
  return 'base';
}

function normalizePhone(raw){
  if(!raw) return '';
  let s=String(raw).trim().replace(/^whatsapp:/i,'').replace(/\s+/g,'');
  if (s.startsWith('00')) s='+'+s.slice(2);
  if (!s.startsWith('+') && /^\d{6,15}$/.test(s)) { if (s.startsWith('39')) s='+'+s; }
  s=s.replace(/[^\d+]/g,'');
  return /^\+\d{6,15}$/.test(s)?s:'';
}
function getWhatsAppNumber(session){
  const c=[]; const p=pick(session,'customer_details.phone',''); if(p) c.push(p);
  for (const cf of (Array.isArray(session?.custom_fields)?session.custom_fields:[])){
    const k=String(cf?.key||'').toLowerCase();
    if (k.includes('phone')||k==='whatsapp'||k==='wa'){ const v=String(cf?.text?.value||'').trim(); if(v) c.push(v); }
  }
  for (const r of c){ const e=normalizePhone(r); if(e) return e; }
  return '';
}

async function minutesFromLineItems(session){
  const rules=parseRules();
  const items=await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum=0;
  for(const li of (items.data||[])){
    const qty=li?.quantity||1;
    const priceId=li?.price?.id;
    if(priceId&&rules[priceId]){ sum+=Number(rules[priceId].minutes||0)*qty; continue; }
    const m1=Number(pick(li,'price.metadata.minutes',0))||0;
    const m2=Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum+=(m1||m2)*qty;
  }
  return sum;
}

async function getExcuses(kind, need, style, locale){
  try{
    const r=await fetchFn(`${SITE_URL}/.netlify/functions/ai-excuse`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ kind, need, style: style||'neutro', locale: locale||'it-IT', maxLen:320 })
    });
    const data=await r.json().catch(()=> ({}));
    const arr=Array.isArray(data?.variants)?data.variants.map(v=>String(v.whatsapp_text||'').trim()).filter(Boolean):[];
    if (arr.length===3) return arr;
  }catch{}
  return [
    'Imprevisto reale: riduco l’attesa e ti aggiorno a breve.',
    'Chiudo un’urgenza e torno con tempi chiari tra poco.',
    'Mi riorganizzo subito: minimizzo il ritardo e ti tengo allineato.'
  ];
}

// Twilio WA (Body libero; se usi template, sostituisci con ContentSid)
async function sendWhatsApp(toE164, text){
  if(!TW_SID||!TW_TOKEN||!TW_FROM_WA) return { ok:false, reason:'no_twilio_env' };
  const url=`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body=new URLSearchParams({ From:TW_FROM_WA, To:`whatsapp:${toE164}`, Body:String(text||'').slice(0,1200) }).toString();
  const r=await fetchFn(url,{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')}, body });
  const data=await r.json().catch(()=> ({}));
  if (r.ok && !data.error_code) return { ok:true, sid:data.sid||null };
  return { ok:false, reason:data?.message||data?.error_message||`http_${r.status}`, data };
}

// Resend Email con from @colpamia.com + errore propagato
async function sendEmail(to, subject, html){
  if(!RESEND_KEY) return { ok:false, reason:'no_resend_env' };
  const r=await fetchFn('https://api.resend.com/emails',{
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      from: 'COLPA MIA <no-reply@colpamia.com>',
      to: [to],
      subject,
      html,
      text: String(html).replace(/<[^>]+>/g,' ').slice(0,1000),
      reply_to: 'support@colpamia.com'
    })
  });
  const data=await r.json().catch(()=> ({}));
  if (r.ok) return { ok:true, id:data?.id||null };
  return { ok:false, reason: data?.message || data?.error?.message || `http_${r.status}`, data };
}

// === Handler ===
exports.handler = async (event)=>{
  const sig = event.headers['stripe-signature'] || '';
  let type, obj;
  try{
    const ev = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    type = ev.type; obj = ev.data.object;
  }catch(e){ return j(400,{ error:'invalid_signature', detail:String(e?.message||e) }); }

  if (type!=='checkout.session.completed') return j(200,{ ok:true, ignored:true });

  try{
    const session = await stripe.checkout.sessions.retrieve(obj.id, { expand:['total_details.breakdown'] });

    // email con fallback
    const email = String(
      pick(session,'customer_details.email','') ||
      pick(session,'customer_email','') || ''
    ).toLowerCase().trim();

    const locale  = String(session?.locale || 'it-IT');
    const kind    = skuToKind(session?.client_reference_id || pick(session,'metadata.sku','') || '');
    const minutes = await minutesFromLineItems(session);

    // need dal custom field 'need' se presente
    let need = '';
    for (const cf of (Array.isArray(session?.custom_fields)?session.custom_fields:[])){
      if (String(cf?.key||'')==='need' && cf?.text?.value){ need = String(cf.text.value).trim(); break; }
    }

    const variants = await getExcuses(kind, need, 'neutro', locale);

    // WA
    const phoneE164 = getWhatsAppNumber(session);
    let waStatus='skip:no_phone';
    if (phoneE164){
      const text = 'La tua Scusa (3 varianti):\n' +
        variants.map((v,i)=>`${i+1}) ${v}`).join('\n') +
        `\n\n(+${minutes} min accreditati su COLPA MIA)`;
      const wa = await sendWhatsApp(phoneE164, text);
      waStatus = wa.ok ? 'sent' : `fail:${wa.reason||'unknown'}`;
    }

    // Email
    let emailSent=false, emailError=null;
    if (email){
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 8px">La tua scusa (3 varianti)</h2>
          <ol style="padding-left:18px">${variants.map(v=>`<li>${v}</li>`).join('')}</ol>
          <p style="margin-top:12px;color:#444">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
          <p style="margin-top:10px;color:#888;font-size:12px">Mittente: no-reply@colpamia.com</p>
        </div>`;
      const em = await sendEmail(email, 'La tua Scusa — COLPA MIA', html);
      emailSent = !!em.ok;
      if (!em.ok) emailError = em.reason || 'unknown';
    }

    // metadata PI per diagnosi
    if (session.payment_intent){
      try{
        await stripe.paymentIntents.update(session.payment_intent, {
          metadata:{
            excusesCount: String(variants.length),
            minutesCredited: String(minutes),
            customerEmail: email || '',
            customerPhoneE164: phoneE164 || '',
            colpamiaWaStatus: waStatus,
            colpamiaEmailSent: emailSent ? 'true':'false',
            colpamiaEmailError: emailError || ''
          }
        });
      }catch{}
    }

    return j(200,{ ok:true, minutes, emailSent, emailError, waStatus, variants: variants.length, kind });
  }catch(e){
    return j(500,{ error:'webhook_error', detail:String(e?.message||e) });
  }
};
