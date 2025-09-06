// netlify/functions/stripe-webhook.js
// Genera SEMPRE 3 varianti: ai-excuse -> OpenAI diretto -> fallback locale.
// Invia email (Resend) e, se configurato, WhatsApp (Twilio).

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resendKey = (process.env.RESEND_API_KEY || '').trim();
const resend = resendKey ? new Resend(resendKey) : null;
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twSid   = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const twTok   = (process.env.TWILIO_AUTH_TOKEN  || '').trim();
const twFrom  = (process.env.TWILIO_FROM_WA     || '').trim(); // es. whatsapp:+14155238886
const twilio  = (twSid && twTok) ? require('twilio')(twSid, twTok) : null;

const ORIGIN  = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/, '');
const OPENAI  = (process.env.OPENAI_API_KEY || '').trim();

function http(s,b){ return {statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)} }
const get = (o,p, d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a?.[c]), o) ?? d }catch{ return d } };

function minutesFromEnv(priceId){
  try{
    const MAP = JSON.parse(process.env.PRICE_RULES_JSON || '{}'); // { price_xxx: {minutes, excuse} }
    return MAP[priceId] || null;
  }catch{ return null; }
}

function normPhone(e164){
  const s = String(e164||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(s)) return s;
  if (/^\+\d{6,15}$/.test(s)) return `whatsapp:${s}`;
  return null;
}

/* ========================== AI LAYER ========================== */

// 1) chiama la tua function ai-excuse
async function askAiExcuse_viaFunction(payload){
  try{
    const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    const j = await r.json().catch(()=> ({}));
    const out = Array.isArray(j?.variants) ? j.variants.filter(v => (v?.whatsapp_text || v?.sms)) : [];
    return out.slice(0,3);
  }catch{ return []; }
}

// 2) OpenAI diretto (Responses API)
async function askAiExcuse_viaOpenAI(payload){
  if(!OPENAI) return [];
  const system = [
    "Sei lo scrittore principale di COLPA MIA.",
    "Genera 3 SCUSE credibili, varie, naturali, senza rischi legali/sanitari; niente persone reali.",
    "Output SOLO JSON: { \"variants\": [ {\"style_label\":\"A\",\"sms\":\"\",\"whatsapp_text\":\"\",\"email_subject\":\"\",\"email_body\":\"\"}, ... ] }"
  ].join(' ');
  const body = {
    model: 'gpt-4o-mini',
    input: [
      { role:'system', content: system },
      { role:'user',   content: `Restituisci JSON valido per il seguente task:\n${JSON.stringify(payload)}` }
    ],
    temperature: 0.85, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.25
  };
  try{
    const r = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${OPENAI}`, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if(!r.ok) return [];
    const txt = j.output_text || '';
    let parsed;
    try{ parsed = JSON.parse(txt) }catch{
      const m = String(txt).match(/\{[\s\S]*\}$/); parsed = m ? JSON.parse(m[0]) : {};
    }
    const out = Array.isArray(parsed?.variants) ? parsed.variants : [];
    return out.slice(0,3);
  }catch{ return []; }
}

// 3) Fallback locale: SEMPRE 3 varianti
function localExcuses(context, persona){
  const need = (String(context||'').trim() || 'imprevisto').slice(0,120);
  const base = [
    `Ho avuto un imprevisto e sto riorganizzando al volo. Arrivo più tardi del previsto; ti aggiorno entro le 18. (${need})`,
    `È saltata fuori una cosa urgente che non posso rimandare. Preferisco non promettere tempi a caso: ti mando ETA entro sera. (${need})`,
    `Situazione imprevista che mi blocca un attimo. Non voglio darti buca: ti scrivo entro le 18 con un nuovo orario. (${need})`
  ];
  return [
    { style_label:'A', sms:base[0], whatsapp_text:base[0], email_subject:'Aggiornamento sui tempi', email_body:base[0] },
    { style_label:'B', sms:base[1], whatsapp_text:base[1], email_subject:'Piccolo imprevisto',      email_body:base[1] },
    { style_label:'C', sms:base[2], whatsapp_text:base[2], email_subject:'Nuovo orario in arrivo',  email_body:base[2] },
  ];
}

// Orchestratore: ritorna SEMPRE array non vuoto
async function buildExcuses({context, persona, style='neutro', locale='it-IT'}){
  const payload = { need:context||'', persona:persona||'generico', style, locale, maxLen:300 };

  // 1) function
  let v = await askAiExcuse_viaFunction(payload);
  if(v.length) return v;

  // 2) OpenAI diretto
  v = await askAiExcuse_viaOpenAI(payload);
  if(v.length) return v;

  // 3) fallback locale
  return localExcuses(context, persona);
}

/* ========================== EMAIL / WA ========================= */

async function sendEmail(to, minutes, variants){
  if(!resend) return {ok:false, reason:'no_resend_key'};
  const block = variants.map(v => (
    `<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px;">${(v.whatsapp_text || v.sms || '').replace(/\n/g,'<br>')}</p>`
  )).join('');
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
    <h2 style="margin:0 0 12px">La tua scusa</h2>
    ${block}
    <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
    <p style="font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
  </div>`;
  try{
    await resend.emails.send({ from: MAIL_FROM, to, subject:'La tua scusa è pronta ✅', html });
    return {ok:true};
  }catch(e){ return {ok:false, reason:String(e?.message||'send_error')} }
}

async function sendWhatsApp(toE164, text){
  if(!twilio || !twFrom) return {ok:false, reason:'twilio_not_configured'};
  const to = normPhone(toE164); if(!to) return {ok:false, reason:'bad_phone'};
  try{
    const r = await twilio.messages.create({ from: twFrom, to, body: text });
    return {ok:true, sid:r.sid};
  }catch(e){ return {ok:false, reason:String(e?.message||'wa_error')} }
}

/* ========================== HANDLER ========================== */

exports.handler = async (event) => {
  try{
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if(!sig) return http(400,{error:'missing_signature'});
    const whsec = process.env.STRIPE_WEBHOOK_SECRET;
    const ev = stripe.webhooks.constructEvent(event.body, sig, whsec);

    if(ev.type !== 'checkout.session.completed') return http(200,{received:true, ignored:ev.type});
    const session = ev.data.object;

    // email utente
    const email = (get(session,'customer_details.email') || session.customer_email || '').toLowerCase();
    if(!email) return http(200,{ok:true, ignored:'no_email'});

    // minuti (somma su line items)
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit:100, expand:['data.price.product'] });
    let minutes = 0, personaHint = '';
    for(const li of items.data){
      const priceId = get(li,'price.id');
      const rule = minutesFromEnv(priceId) || {};
      minutes += (Number(rule.minutes||0) * (li.quantity||1)) || 0;
      if(!personaHint && rule.excuse) personaHint = String(rule.excuse||'');
    }
    if(minutes <= 0) minutes = 10; // minimo 10, così l’email non mostra 0

    // contesto dal checkout (custom field "need")
    let context = '';
    const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
    for(const cf of cfs){ if((cf.key||'').toLowerCase()==='need' && cf?.text?.value){ context = String(cf.text.value||'').trim(); break; } }

    // ====== AI: SEMPRE 3 VARIANTI ======
    const variants = await buildExcuses({ context, persona: personaHint || 'generico', style:'neutro', locale:'it-IT' });

    // Email
    await sendEmail(email, minutes, variants);

    // WhatsApp (best-effort)
    const phones = new Set();
    const sPhone  = get(session,'customer_details.phone'); if(sPhone) phones.add(sPhone);
    const piId = String(session.payment_intent||'');
    let chargePhone = null;
    try{
      if(piId){
        const pi = await stripe.paymentIntents.retrieve(piId, { expand:['charges.data.balance_transaction'] });
        chargePhone = get(pi,'charges.data.0.billing_details.phone');
        if(chargePhone) phones.add(chargePhone);
      }
    }catch{}
    try{
      const custId = session.customer;
      if(custId){
        const cust = await stripe.customers.retrieve(custId);
        if(cust?.phone) phones.add(cust.phone);
        if(cust?.metadata?.phone) phones.add(cust.metadata.phone);
      }
    }catch{}

    if(phones.size){
      const text = [
        'La tua Scusa (3 varianti):',
        ...variants.map((v,i)=> `${i+1}) ${(v.whatsapp_text || v.sms || '').replace(/\s+\n/g,' ').trim()}`),
        '',
        '(inviato da COLPA MIA)'
      ].join('\n');
      for(const p of phones){ await sendWhatsApp(p, text); break; }
    }

    return http(200,{ ok:true, minutes, email, variants: variants.length });

  }catch(e){
    return http(500,{ error:String(e?.message||'webhook_error') });
  }
};

