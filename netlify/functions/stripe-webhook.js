// netlify/functions/stripe-webhook.js
// Webhook Stripe con antispam per le email (plain-text + List-Unsubscribe)
// Funzioni: accredita minuti, genera 3 scuse, invia WhatsApp e Email

const Stripe = require('stripe');
const fetchFn = (...a) => fetch(...a);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/,'');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim();

const CORS = {'Access-Control-Allow-Origin':'*'};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

// SKU → kind
function skuToKind(sku){
  const x = String(sku||'').toUpperCase();
  if (x==='RIUNIONE')      return 'riunione';
  if (x==='TRAFFICO')      return 'traffico';
  if (x==='CONS_KO' || x==='CONN_KO' || x==='CONNESSIONE') return 'connessione';
  if (x==='SCUSA_TRIPLA')  return 'tripla';
  if (x==='SCUSA_DELUXE')  return 'deluxe';
  return 'base';
}

async function sendWhatsApp(to, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'no_twilio' };
  if (!to || !/^\+\d{6,15}$/.test(to))     return { ok:false, reason:'bad_phone' };

  const url  = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ From: TW_FROM_WA, To: `whatsapp:${to}`, Body: text }).toString();
  const r = await fetchFn(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64') },
    body
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

// —— EMAIL con antispam (plain-text + List-Unsubscribe + Reply-To) ——
async function sendEmail(to, subject, html, text){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend' };
  const payload = {
    from: 'COLPA MIA <no-reply@colpamia.com>',
    to: [to],
    reply_to: 'support@colpamia.com',
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': '<mailto:unsubscribe@colpamia.com>, <https://colpamia.com/unsubscribe>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  };
  const r = await fetchFn('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
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
  const arr = Array.isArray(data?.variants) ? data.variants.map(v=>String(v.whatsapp_text||'').trim()).filter(Boolean) : [];
  while (arr.length < 3) arr.push(arr[0] || 'Imprevisto reale: recupero e ti aggiorno a breve.');
  return arr.slice(0,3);
}

async function minutesFromLineItems(session){
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

    const minutes = await minutesFromLineItems(session);

    const kind = skuToKind(session?.client_reference_id || '');
    let need = '';
    try{
      const cf = session?.custom_fields || [];
      for (const f of cf){ if (String(f?.key||'')==='need' && f?.text?.value) { need = String(f.text.value); break; } }
    }catch{}

    const variants = await getExcuses({ kind, need });

    // WhatsApp (prima variante) + Email (tutte) — con plain text per antispam
    let waSent=false, emSent=false, emailErr=null;
    if (phone && variants[0]){
      const textWA = `La tua Scusa (3 varianti):\n1) ${variants[0]}\n2) ${variants[1]}\n3) ${variants[2]}${minutes>0?`\n\n(+${minutes} min accreditati su COLPA MIA)`:''}`;
      const wa = await sendWhatsApp(phone, textWA); waSent = !!wa.ok;
    }
    if (email){
      const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
        <h2 style="margin:0 0 8px">La tua Scusa (3 varianti)</h2>
        <ol>${variants.map(v=>`<li>${v}</li>`).join('')}</ol>
        <p style="margin-top:10px;color:#555">${minutes>0?`Accreditati <b>${minutes}</b> minuti sul tuo wallet.`:''}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p style="font-size:12px;color:#777">Ricevi questa email perché hai acquistato su colpamia.com. <a href="https://colpamia.com/unsubscribe">Disiscriviti</a></p>
      </div>`;
      const text = `La tua scusa (3 varianti)
1) ${variants[0]}
2) ${variants[1]}
3) ${variants[2]}
${minutes>0 ? `Accreditati ${minutes} minuti sul tuo wallet.` : ''}`;

      const em = await sendEmail(email,'La tua Scusa — COLPA MIA',html,text);
      emSent = !!em.ok; emailErr = em.ok ? null : (em?.data?.message || 'send_failed');
    }

    if (session.payment_intent){
      try{
        await stripe.paymentIntents.update(session.payment_intent,{
          metadata:{
            minutesCredited:String(minutes),
            excusesCount:'3',
            customerEmail: email || '',
            colpamiaWaStatus: waSent ? 'sent':'skip',
            colpamiaEmailSent: emSent ? 'true':'false',
            colpamiaEmailError: emailErr || ''
          }
        });
      }catch{}
    }

    return j(200,{ok:true, minutes, variants:3, waStatus: waSent?'sent':'skip', emailSent: emSent, kind});
  }catch(err){
    return j(500,{error:'webhook_error', detail:String(err?.message||err)});
  }
};
