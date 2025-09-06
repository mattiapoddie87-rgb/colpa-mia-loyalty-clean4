// netlify/functions/stripe-webhook.js
// - Genera 3 scuse PERSONALIZZATE (usa custom_fields.need + persona dal price)
// - Invia WhatsApp con TUTTE le varianti + Email con TUTTE le varianti
// - Accredita minuti anche con promo (no_payment_required) e aggiorna PI.metadata
// - Aggancia customerEmail per il wallet

const Stripe = require('stripe');
const fetchFn = (...a) => fetch(...a);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL   = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim(); // 'whatsapp:+14155238886'

const CORS = { 'Access-Control-Allow-Origin':'*' };
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } };
function readJsonEnv(k){ try{ return JSON.parse(process.env[k] || '{}'); } catch{ return {}; } }
const RULES = readJsonEnv('PRICE_RULES_JSON'); // { price_xxx: { minutes, excuse } }

async function listItems(sessionId){
  try{
    return await stripe.checkout.sessions.listLineItems(sessionId,{limit:100, expand:['data.price.product']});
  }catch{ return {data:[]}; }
}

async function minutesFromLineItems(session){
  const items = await listItems(session.id);
  let sum = 0;
  for (const li of (items.data||[])){
    const qty = li?.quantity || 1;
    const priceId = li?.price?.id;
    if (priceId && RULES[priceId]) { sum += Number(RULES[priceId].minutes||0) * qty; continue; }
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

function personaFromItems(session){
  // prendi la prima "excuse" definita nei rules dei line items
  // fallback 'generico'
  const items = session.__items; // iniettato dopo
  for (const li of (items?.data||[])){
    const priceId = li?.price?.id;
    if (priceId && RULES[priceId]?.excuse) return String(RULES[priceId].excuse);
  }
  return 'generico';
}

function needFromCustomFields(session){
  const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  for (const cf of cfs){
    if (String(cf?.key||'').toLowerCase()==='need' && cf?.text?.value){
      return String(cf.text.value).trim();
    }
  }
  return '';
}

async function sendWhatsApp(e164, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'twilio_not_configured' };
  if (!/^\+\d{6,15}$/.test(String(e164||'')))    return { ok:false, reason:'bad_phone' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ From: TW_FROM_WA, To: `whatsapp:${e164}`, Body: text }).toString();
  const r = await fetchFn(url, {
    method:'POST',
    headers:{
      'Content-Type':'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')
    },
    body
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend_key' };
  const r = await fetchFn('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from:'COLPA MIA <onboarding@resend.dev>', to:[to], subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

async function getExcuses({ need, persona, style, locale, seed }){
  // chiama la tua function ai-excuse (stesso motore del chatbot)
  const r = await fetchFn(`${SITE_URL}/.netlify/functions/ai-excuse`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ need, persona, style, locale, maxLen:320, seed })
  });
  const data = await r.json().catch(()=> ({}));
  const arr = Array.isArray(data?.variants) ? data.variants : [];
  // Estrarre il testo whatsapp/sms e filtrare vuoti
  const texts = arr.map(v => String(v.whatsapp_text || v.sms || '').trim()).filter(Boolean);
  // Se meno di 3, duplica con lievi variazioni per non lasciare buchi
  while (texts.length < 3) {
    const base = texts[texts.length-1] || texts[0] || 'Imprevisto in corso, ti aggiorno a breve.';
    texts.push(base.replace(/\.$/,'') + ' (var.)');
  }
  return texts.slice(0,3);
}

exports.handler = async (event) => {
  // Verifica firma
  let evt;
  try{
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(err){
    return j(400,{ error:'invalid_signature', detail:String(err?.message||err) });
  }

  if (evt.type !== 'checkout.session.completed') return j(200,{ ok:true, ignored:true });

  try{
    // Sessione + items (inject per persona)
    const session = await stripe.checkout.sessions.retrieve(evt.data.object.id, { expand: ['total_details.breakdown'] });
    session.__items = await listItems(session.id);

    const email = (session?.customer_details?.email || '').trim().toLowerCase();
    const phone = (session?.customer_details?.phone || '').trim();
    const locale= session?.locale || 'it-IT';

    // minuti da line items (funziona anche con promo free)
    const minutes = await minutesFromLineItems(session);

    // segnali AI
    const persona = personaFromItems(session);                 // es. 'riunione', 'traffico', 'conn', 'deluxe', ...
    const needRaw = needFromCustomFields(session);
    const need    = needRaw || `Serve una scusa ${persona} credibile, in italiano, tono misurato.`;
    const style   = 'neutro';
    const seed    = session.id;                                // per variare run-to-run

    // 3 varianti
    const variants = await getExcuses({ need, persona, style, locale, seed }); // array di 3 stringhe

    // WhatsApp: manda tutte e 3 in un unico messaggio
    let waSent = false;
    if (phone && variants.length){
      const text =
        `COLPA MIA — Le tue scuse (${persona}):\n\n` +
        variants.map((v,i)=>`${i+1}) ${v}`).join('\n\n') +
        `\n\n(+${minutes} min accreditati sul wallet)`;
      const w = await sendWhatsApp(phone, text);
      waSent = !!w.ok;
    }

    // Email: manda tutte e 3 in lista
    let emailSent = false;
    if (email && variants.length){
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 10px">La tua scusa (${persona})</h2>
          <ol>${variants.map(v=>`<li>${v}</li>`).join('')}</ol>
          <p style="margin-top:12px">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
        </div>`;
      const em = await sendEmail(email, 'La tua Scusa — COLPA MIA', html);
      emailSent = !!em.ok;
    }

    // Aggiorna PI.metadata quando esiste (se promo 100% non c’è PI → ok)
    if (session.payment_intent){
      const meta = {
        minutesCredited: String(minutes),
        excusesCount: String(variants.length),
        colpamiaEmailSent: emailSent ? 'true' : 'false',
        colpamiaWaStatus: waSent ? 'sent' : 'skip'
      };
      if (email) meta.customerEmail = email;  // fondamentale per wallet vecchio
      try{ await stripe.paymentIntents.update(session.payment_intent, { metadata: meta }); } catch {}
    }

    return j(200,{ ok:true, emailSent, waSent, minutes, variants: variants.length, persona, used_need: need });
  }catch(err){
    return j(500,{ error:'webhook_error', detail:String(err?.message||err) });
  }
};
