// netlify/functions/stripe-webhook.js
// - Mappa SKU → kind (riunione, traffico, connessione, base, tripla, deluxe)
// - Chiama ai-excuse passando {kind, need, style, locale} (restituisce 1 o più varianti)
// - Aggiorna metadata PaymentIntent e invia WhatsApp + Email (saltati per COLPA_*)

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

// sku → kind
function skuToKind(sku){
  const x = String(sku||'').toUpperCase();
  if (x.startsWith('COLPA_'))  return 'colpa';
  if (x==='RIUNIONE')          return 'riunione';
  if (x==='TRAFFICO')          return 'traffico';
  if (x==='CONS_KO' || x==='CONN_KO' || x==='CONNESSIONE') return 'connessione';
  if (x==='SCUSA_TRIPLA' || x==='TRIPLA')  return 'tripla';
  if (x==='SCUSA_DELUXE' || x==='DELUXE')  return 'deluxe';
  return 'base';
}

async function sendWhatsApp(to, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'no_twilio' };
  if (!to || !/^\+\d{6,15}$/.test(to))     return { ok:false, reason:'bad_phone' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ From: TW_FROM_WA, To: `whatsapp:${to}`, Body: text }).toString();
  const r = await fetchFn(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64') },
    body
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend' };
  const r = await fetchFn('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from:'COLPA MIA <no-reply@colpamia.com>', reply_to:'support@colpamia.com', to:[to], subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

async function getExcuses({kind, need, style='neutro', locale='it-IT', maxLen=320}){
  const r = await fetchFn(`${SITE_URL}/.netlify/functions/ai-excuse`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ kind, need, style, locale, maxLen })
  });
  const data = await r.json().catch(()=> ({}));
  // restituisce array di oggetti { whatsapp_text }
  const arr = Array.isArray(data?.variants)
    ? data.variants.map(v=>String(v.whatsapp_text||'').trim()).filter(Boolean)
    : [];
  return arr; // può essere 1 (base) o N (deluxe/altro)
}

async function minutesFromLineItems(session){
  // Somma "minutes" da metadata su Price/Product × qty
  const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } };
  const items = await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum=0;
  for (const li of (items.data||[])){
    const qty = li?.quantity || 1;
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

exports.handler = async (event)=>{
  const sig = event.headers['stripe-signature'] || '';
  let type, obj;
  try{
    const evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    type = evt.type; obj = evt.data.object;
  }catch(err){ return j(400,{error:'invalid_signature'}); }

  if (type!=='checkout.session.completed') return j(200,{ok:true,ignored:true});

  try{
    const session = await stripe.checkout.sessions.retrieve(obj.id);
    const email = (session?.customer_details?.email || '').toLowerCase().trim();
    const phone = (session?.customer_details?.phone || '').trim();

    const sku  = String(session?.client_reference_id || '').toUpperCase();
    const kind = skuToKind(sku);

    // Pacchetti "COLPA_*": non inviamo scuse/email/WA. Segniamo metadata e usciamo.
    if (sku.startsWith('COLPA_')){
      if (session.payment_intent){
        try{
          await stripe.paymentIntents.update(session.payment_intent,{
            metadata:{
              colpaPackage:'true',
              excusesSkipped:'true',
              minutesCredited:'0',
              customerEmail: email || ''
            }
          });
        }catch{}
      }
      return j(200,{ok:true, colpa:true, waSent:false, emSent:false, minutes:0, variants:0, kind});
    }

    const minutes = await minutesFromLineItems(session);

    // Contesto (se presente su custom_fields → chiave 'need')
    let need = '';
    try{
      const cf = session?.custom_fields || [];
      for (const f of cf){ if (String(f?.key||'')==='need' && f?.text?.value) { need = String(f.text.value); break; } }
    }catch{}

    const variants = await getExcuses({ kind, need });
    const count = variants.length;

    // WhatsApp (include tutte le varianti disponibili)
    let waSent=false, emSent=false;
    if (phone && count>0){
      let text;
      if (count===1){
        text = `La tua Scusa:\n• ${variants[0]}\n\n(+${minutes} min accreditati su COLPA MIA)`;
      }else{
        text = `La tua Scusa (${count} varianti):\n` + variants.map((v,i)=>`${i+1}) ${v}`).join('\n') + `\n\n(+${minutes} min accreditati su COLPA MIA)`;
      }
      const wa = await sendWhatsApp(phone, text); waSent = !!wa.ok;
    }

    if (email && count>0){
      let html;
      if (count===1){
        html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
          <h2>La tua Scusa</h2>
          <p>${variants[0]}</p>
          <p style="margin-top:10px;color:#555">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p></div>`;
      }else{
        html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
          <h2>La tua Scusa</h2><ol>${variants.map(v=>`<li>${v}</li>`).join('')}</ol>
          <p style="margin-top:10px;color:#555">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p></div>`;
      }
      const em = await sendEmail(email,'La tua Scusa — COLPA MIA',html); emSent = !!em.ok;
    }

    if (session.payment_intent){
      try{
        await stripe.paymentIntents.update(session.payment_intent,{
          metadata:{
            minutesCredited:String(minutes),
            excusesCount:String(count),
            customerEmail: email || '',
            colpamiaWaStatus: waSent ? 'sent':'skip',
            colpamiaEmailSent: emSent ? 'true':'false',
            sku
          }
        });
      }catch{}
    }

    return j(200,{ok:true, minutes, variants:count, waSent, emSent, kind});
  }catch(err){
    return j(500,{error:'webhook_error', detail:String(err?.message||err)});
  }
};
