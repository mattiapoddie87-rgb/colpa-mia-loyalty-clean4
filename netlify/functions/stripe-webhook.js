// netlify/functions/stripe-webhook.js
// Checkout → 3 scuse (con contesto) → Email (anti-spam) → WhatsApp → Wallet cumulativo su Stripe Customer

const Stripe = require('stripe');
const fetchFn = (...a) => fetch(...a);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/,'');
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN  || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA     || '').trim();

const CORS = {'Access-Control-Allow-Origin':'*'};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b) });

const pick=(x,p,d=null)=>{try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}};
const parseRules=()=>{ try{ return JSON.parse(process.env.PRICE_RULES_JSON||'{}'); }catch{ return {}; } };

// ——— Helpers ———
function skuToKind(s){
  const x=String(s||'').toUpperCase();
  if (x.includes('RIUNIONE')) return 'riunione';
  if (x.includes('TRAFFICO')) return 'traffico';
  if (x.includes('CONN'))     return 'connessione';
  if (x.includes('DELUXE'))   return 'deluxe';
  if (x.includes('TRIPLA'))   return 'tripla';
  return 'base';
}
function normalizePhone(raw){
  if(!raw)return''; let s=String(raw).trim().replace(/^whatsapp:/i,'').replace(/\s+/g,'');
  if(s.startsWith('00')) s='+'+s.slice(2);
  if(!s.startsWith('+')&&/^\d{6,15}$/.test(s)){ if(s.startsWith('39')) s='+'+s; }
  s=s.replace(/[^\d+]/g,''); return /^\+\d{6,15}$/.test(s)?s:'';
}
function getWhatsAppNumber(session){
  const c=[]; const p=pick(session,'customer_details.phone',''); if(p)c.push(p);
  for(const cf of (Array.isArray(session?.custom_fields)?session.custom_fields:[])){
    const k=String(cf?.key||'').toLowerCase();
    if(k.includes('phone')||k==='whatsapp'||k==='wa'){ const v=String(cf?.text?.value||'').trim(); if(v)c.push(v); }
  }
  for(const r of c){ const e=normalizePhone(r); if(e) return e; }
  return '';
}

// minuti: rules JSON (per SKU) ha priorità; poi metadata su price/product
async function minutesFromSession(session){
  const rules = parseRules();
  const sku   = String(session?.client_reference_id || pick(session,'metadata.sku','') || '').toUpperCase();
  if (sku && rules[sku] && Number(rules[sku].minutes||0) > 0) return Number(rules[sku].minutes);

  const items=await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum=0;
  for(const li of (items.data||[])){
    const qty=li?.quantity||1;
    const m1=Number(pick(li,'price.metadata.minutes',0))||0;
    const m2=Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum+=(m1||m2)*qty;
  }
  return sum;
}

// estrae un "context_tag" dal campo need se coincide con le nostre etichette
function parseContextTag(need){
  const raw=String(need||'').toUpperCase().trim();
  const map={
    'CENA':'CENA','APERITIVO':'APERITIVO','EVENTO':'EVENTO','LAVORO':'LAVORO',
    'PARTITA A CALCETTO':'CALCETTO','CALCETTO':'CALCETTO',
    'FAMIGLIA':'FAMIGLIA','SALUTE':'SALUTE',
    'APPUNTAMENTO/CONSEGNA':'APP_CONS','APPUNTAMENTO':'APP_CONS','CONSEGNA':'APP_CONS',
    'ESAME/LEZIONE':'ESAME','ESAME':'ESAME','LEZIONE':'ESAME'
  };
  return map[raw] || '';
}

// ——— Twilio / Email ———
async function sendWhatsApp(to,text){
  if(!TW_SID||!TW_TOKEN||!TW_FROM_WA) return {ok:false,reason:'no_twilio_env'};
  const url=`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body=new URLSearchParams({From:TW_FROM_WA,To:`whatsapp:${to}`,Body:String(text||'').slice(0,1200)}).toString();
  const r=await fetchFn(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')},body});
  const data=await r.json().catch(()=>({})); if(r.ok && !data.error_code) return {ok:true,sid:data.sid||null};
  return {ok:false,reason:data?.message||data?.error_message||`http_${r.status}`,data};
}
async function sendEmail(to,subject,html,text){
  if(!RESEND_KEY) return {ok:false,reason:'no_resend_env'};
  const r=await fetchFn('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({
      from: 'COLPA MIA <no-reply@colpamia.com>',
      to:[to],
      reply_to:'support@colpamia.com',
      subject, html, text,
      headers:{
        'List-Unsubscribe':'<mailto:unsubscribe@colpamia.com>, <https://colpamia.com/unsubscribe>',
        'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'
      }
    })
  });
  const data=await r.json().catch(()=>({})); if(r.ok) return {ok:true,id:data?.id||null};
  return {ok:false,reason:data?.message||data?.error?.message||`http_${r.status}`,data};
}

// ——— AI excuses ———
async function getExcuses({kind, contextTag, need, style='neutro', locale='it-IT', maxLen=320}){
  const r=await fetchFn(`${SITE_URL}/.netlify/functions/ai-excuse`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ kind, contextTag, need, style, locale, maxLen })
  });
  const data=await r.json().catch(()=>({}));
  const arr=Array.isArray(data?.variants)?data.variants.map(v=>String(v.whatsapp_text||'').trim()).filter(Boolean):[];
  while(arr.length<3) arr.push(arr[0]||'Imprevisto reale: recupero e ti aggiorno a breve.');
  return arr.slice(0,3);
}

// ——— Wallet cumulativo su Stripe Customer ———
async function addToWallet({customerId, email, addMinutes}){
  let custId = customerId || null;

  // se manca customerId ma c'è email, prova a cercare un Customer esistente
  if (!custId && email){
    try{
      const list = await stripe.customers.list({ email, limit: 1 });
      if (list?.data?.[0]) custId = list.data[0].id;
    }catch{}
  }
  // crea customer se ancora mancante
  if (!custId && email){
    try{
      const c = await stripe.customers.create({ email, metadata:{} });
      custId = c.id;
    }catch{}
  }
  if (!custId) return { customerId:null, walletTotal:0, vitaTotal:0 };

  // leggi attuali
  let walletPrev=0, vitaPrev=0;
  try{
    const c=await stripe.customers.retrieve(custId);
    walletPrev = Number(pick(c,'metadata.walletMinutesTotal',0))||0;
    vitaPrev   = Number(pick(c,'metadata.vitaPointsTotal',0))||0;
  }catch{}

  const add = Math.max(0, Number(addMinutes||0));
  const walletNew = walletPrev + add;
  const vitaNew   = vitaPrev + add; // 1 minuto = 1 punto vita

  try{
    await stripe.customers.update(custId,{
      metadata:{
        walletMinutesTotal: String(walletNew),
        vitaPointsTotal:    String(vitaNew),
        walletUpdatedAt:    String(Date.now())
      }
    });
  }catch{}

  return { customerId: custId, walletTotal: walletNew, vitaTotal: vitaNew };
}

// ——— Handler ———
exports.handler = async (event)=>{
  const sig = event.headers['stripe-signature'] || '';
  let type,obj;
  try{
    const ev=stripe.webhooks.constructEvent(event.body,sig,process.env.STRIPE_WEBHOOK_SECRET);
    type=ev.type; obj=ev.data.object;
  }catch(e){ return j(400,{error:'invalid_signature', detail:String(e?.message||e)}); }

  if(type!=='checkout.session.completed') return j(200,{ok:true,ignored:true});

  try{
    const session = await stripe.checkout.sessions.retrieve(obj.id,{expand:['total_details.breakdown']});
    const email   = String(pick(session,'customer_details.email','') || pick(session,'customer_email','') || '').toLowerCase().trim();
    const phoneE164 = getWhatsAppNumber(session);

    const locale  = String(session?.locale || 'it-IT');
    const kind    = skuToKind(session?.client_reference_id || pick(session,'metadata.sku','') || '');
    const minutes = await minutesFromSession(session);

    // need e contextTag dal custom field 'need'
    let needVal=''; for (const cf of (Array.isArray(session?.custom_fields)?session.custom_fields:[])){
      if (String(cf?.key||'')==='need' && cf?.text?.value){ needVal = String(cf.text.value).trim(); break; }
    }
    const contextTag = parseContextTag(needVal);

    const variants = await getExcuses({ kind, contextTag, need: needVal, style:'neutro', locale });

    // WhatsApp
    let waStatus='skip:no_phone';
    if (phoneE164){
      const text='La tua Scusa (3 varianti):\n'+variants.map((v,i)=>`${i+1}) ${v}`).join('\n')+(minutes>0?`\n\n(+${minutes} min accreditati su COLPA MIA)`:'');
      const wa=await sendWhatsApp(phoneE164,text); waStatus=wa.ok?'sent':`fail:${wa.reason||'unknown'}`;
    }

    // Wallet cumulativo
    const wallet = await addToWallet({ customerId: session.customer || null, email, addMinutes: minutes });

    // Email
    let emailSent=false, emailError=null, resendId=null;
    if (email){
      const minutesLine = minutes>0 ? `<p style="margin-top:8px;color:#444">Accreditati <b>${minutes}</b> minuti su questo ordine.</p>` : '';
      const walletLine  = `<p style="margin-top:4px;color:#444">Totale wallet: <b>${wallet.walletTotal}</b> min — Punti vita: <b>${wallet.vitaTotal}</b>.</p>`;
      const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
        <h2 style="margin:0 0 8px">La tua scusa (3 varianti)</h2>
        <ol style="padding-left:18px">${variants.map(v=>`<li>${v}</li>`).join('')}</ol>
        ${minutesLine}${walletLine}
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p style="font-size:12px;color:#777">Mittente: no-reply@colpamia.com — Hai acquistato su colpamia.com</p>
      </div>`;
      const text = `La tua scusa (3 varianti)
1) ${variants[0]}
2) ${variants[1]}
3) ${variants[2]}
${minutes>0?`Accreditati ${minutes} min su questo ordine.`:''}
Totale wallet: ${wallet.walletTotal} min — Punti vita: ${wallet.vitaTotal}.`;

      const em=await sendEmail(email,'La tua Scusa — COLPA MIA',html,text);
      emailSent=!!em.ok; if(!em.ok) emailError=em.reason||'unknown'; resendId=em.id||null;
    }

    // Metadata PI
    if (session.payment_intent){
      try{
        await stripe.paymentIntents.update(session.payment_intent,{
          metadata:{
            excusesCount:String(variants.length),
            minutesCredited:String(minutes),
            customerEmail: email || '',
            customerPhoneE164: phoneE164 || '',
            colpamiaWaStatus: waStatus,
            colpamiaEmailSent: emailSent?'true':'false',
            colpamiaEmailError: emailError||'',
            colpamiaResendId: resendId||'',
            walletTotalMinutes: String(wallet.walletTotal||0),
            vitaPointsTotal:    String(wallet.vitaTotal||0)
          }
        });
      }catch{}
    }

    return j(200,{ ok:true, kind, contextTag, minutes, waStatus, emailSent, walletTotal:wallet.walletTotal, vitaTotal:wallet.vitaTotal, variants:variants.length });
  }catch(e){
    return j(500,{ error:'webhook_error', detail:String(e?.message||e) });
  }
};
