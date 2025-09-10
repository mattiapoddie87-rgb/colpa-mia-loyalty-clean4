// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const fetchFn = (...a)=>fetch(...a);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const RESEND_KEY = (process.env.RESEND_API_KEY||'').trim();
const SITE_URL   = (process.env.SITE_URL||'').replace(/\/+$/,'');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID||'').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN||'').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA||'').trim();

const CORS = {'Access-Control-Allow-Origin':'*'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}};

// --- mappe ---
function skuToKind(sku){
  const x = String(sku||'').toUpperCase();
  if (x.startsWith('COLPA_')) return 'colpa';
  if (x==='RIUNIONE') return 'riunione';
  if (x==='TRAFFICO') return 'traffico';
  if (x==='CONNESSIONE'||x==='CONS_KO'||x==='CONN_KO') return 'connessione';
  if (x==='SCUSA_DELUXE'||x==='DELUXE') return 'deluxe';
  return 'base';
}
function parseContextTag(raw){
  const s = String(raw||'').toUpperCase().trim();
  const map = {
    'CENA':'CENA','APERITIVO':'APERITIVO','EVENTO':'EVENTO','LAVORO':'LAVORO',
    'PARTITA A CALCETTO':'CALCETTO','CALCETTO':'CALCETTO',
    'FAMIGLIA':'FAMIGLIA','SALUTE':'SALUTE',
    'APPUNTAMENTO/CONSEGNA':'APP_CONS','APPUNTAMENTO':'APP_CONS','CONSEGNA':'APP_CONS',
    'ESAME/LEZIONE':'ESAME','ESAME':'ESAME'
  };
  return map[s]||'';
}

// --- IO ---
async function sendWhatsApp(to, text){
  if (!TW_SID||!TW_TOKEN||!TW_FROM_WA) return {ok:false,reason:'no_twilio'};
  if (!to||!/^\+\d{6,15}$/.test(to))   return {ok:false,reason:'bad_phone'};
  const url=`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body=new URLSearchParams({From:TW_FROM_WA,To:`whatsapp:${to}`,Body:String(text||'').slice(0,1200)}).toString();
  const r=await fetchFn(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')},body});
  const data=await r.json().catch(()=>({}));
  return (r.ok&&!data.error_code)?{ok:true,data}:{ok:false,reason:data?.message||data?.error_message||`http_${r.status}`,data};
}
async function sendEmail(to,subject,html){
  if(!RESEND_KEY) return {ok:false,reason:'no_resend'};
  const r=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'COLPA MIA <no-reply@colpamia.com>',reply_to:'support@colpamia.com',to:[to],subject,html})});
  const data=await r.json().catch(()=>({}));
  return {ok:r.ok,data};
}
async function getExcuses({kind,contextTag,need,maxLen}){
  const r=await fetchFn(`${SITE_URL}/.netlify/functions/ai-excuse`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind,contextTag,need,style:'neutro',locale:'it-IT',maxLen})
  });
  const data=await r.json().catch(()=>({}));
  const arr=Array.isArray(data?.variants)?data.variants.map(v=>String(v.whatsapp_text||'').trim()).filter(Boolean):[];
  return arr;
}
async function minutesFromLineItems(session){
  const items=await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum=0; for(const li of (items.data||[])){const qty=li?.quantity||1;const m1=Number(pick(li,'price.metadata.minutes',0))||0;const m2=Number(pick(li,'price.product.metadata.minutes',0))||0; sum+=(m1||m2)*qty;}
  return sum;
}

// --- handler ---
exports.handler=async(event)=>{
  const sig=event.headers['stripe-signature']||'';
  let type,obj;
  try{const ev=stripe.webhooks.constructEvent(event.body,sig,process.env.STRIPE_WEBHOOK_SECRET);type=ev.type;obj=ev.data.object;}catch(e){return j(400,{error:'invalid_signature'});}
  if(type!=='checkout.session.completed') return j(200,{ok:true,ignored:true});

  try{
    const session=await stripe.checkout.sessions.retrieve(obj.id);
    const email=(session?.customer_details?.email||'').toLowerCase().trim();
    const phone=(session?.customer_details?.phone||'').trim();
    const sku=String(session?.client_reference_id||'').toUpperCase();
    const kind=skuToKind(sku);

    // COLPA_* → nessuna scusa/email/WA
    if(sku.startsWith('COLPA_')){
      if(session.payment_intent){
        try{await stripe.paymentIntents.update(session.payment_intent,{metadata:{colpaPackage:'true',excusesSkipped:'true',minutesCredited:'0',customerEmail:email||''}});}catch{}
      }
      return j(200,{ok:true,colpa:true,minutes:0,variants:0,waSent:false,emSent:false,kind});
    }

    // need + contextTag
    let needVal=''; for(const f of (session?.custom_fields||[])){ if(String(f?.key||'')==='need'&&f?.text?.value){ needVal=String(f.text.value); break; } }
    const contextTag=parseContextTag(needVal);

    const minutes=await minutesFromLineItems(session);

    // maxLen: più largo per DELUXE
    const maxLen = (kind==='deluxe') ? 600 : 480;
    const variants=await getExcuses({kind,contextTag,need:needVal,maxLen});
    const count=variants.length;

    // WhatsApp
    let waSent=false; if(phone&&count>0){
      const text = count===1
        ? `La tua Scusa:\n• ${variants[0]}${minutes>0?`\n\n(+${minutes} min accreditati su COLPA MIA)`:''}`
        : `La tua Scusa (${count} varianti):\n`+variants.map((v,i)=>`${i+1}) ${v}`).join('\n')+`${minutes>0?`\n\n(+${minutes} min accreditati su COLPA MIA)`:''}`;
      const wa=await sendWhatsApp(phone,text); waSent=!!wa.ok;
    }

    // Email
    let emSent=false; if(email&&count>0){
      const html = count===1
        ? `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif"><h2>La tua Scusa</h2><p>${variants[0]}</p><p style="margin-top:10px;color:#555">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p></div>`
        : `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif"><h2>La tua Scusa</h2><ol>${variants.map(v=>`<li>${v}</li>`).join('')}</ol><p style="margin-top:10px;color:#555">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p></div>`;
      const em=await sendEmail(email,'La tua Scusa — COLPA MIA',html); emSent=!!em.ok;
    }

    if(session.payment_intent){
      try{await stripe.paymentIntents.update(session.payment_intent,{metadata:{
        minutesCredited:String(minutes),excusesCount:String(count),customerEmail:email||'',
        colpamiaWaStatus: waSent?'sent':'skip', colpamiaEmailSent: emSent?'true':'false', sku
      }});}catch{}
    }

    return j(200,{ok:true,minutes,variants:count,waSent,emSent,kind,contextTag});
  }catch(err){
    return j(500,{error:'webhook_error',detail:String(err?.message||err)});
  }
};
