// netlify/functions/stripe-webhook.js
// Accredito minuti + email + WhatsApp, anche con promo code (checkout a 0€)

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY || '');
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid   = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN  || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken ? require('twilio')(twilioSid, twilioToken) : null);

function j(s,b){ return { statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}}
function readJsonEnv(k){ try{ return JSON.parse(process.env[k]||'{}') }catch{ return {} } }

// Supporto regole sia per SKU che per PRICE_ID.
// Consigliato: mettere le regole per SKU in PRICE_RULES_JSON (come mi hai mostrato).
const RULES_SKU   = readJsonEnv('PRICE_RULES_JSON');           // { SCUSA_ENTRY:{minutes:10,...}, ... }
const RULES_PRICE = readJsonEnv('PRICE_RULES_BY_PRICE_JSON');  // opzionale: { price_xxx:{minutes:10}, ... }

function minutesForLineItem(li){
  // 1) Preferisci lookup_key = SKU (deve essere impostato su Stripe Price)
  const sku = (li?.price?.lookup_key || '').trim();
  if (sku && RULES_SKU[sku] && Number(RULES_SKU[sku].minutes)>0){
    return Number(RULES_SKU[sku].minutes) * (li.quantity || 1);
  }
  // 2) Fallback a tabella per price.id
  const pid = (li?.price?.id || '').trim();
  if (pid && RULES_PRICE[pid] && Number(RULES_PRICE[pid].minutes)>0){
    return Number(RULES_PRICE[pid].minutes) * (li.quantity || 1);
  }
  return 0;
}

async function addMinutesToCustomer(customerId, email, add){
  if (!add || add<=0) return {ok:false, minutes:0};
  // Recupera o crea Customer (se manca)
  let custId = customerId;
  if (!custId){
    // prova match by email
    const search = await stripe.customers.search({ query: `email:"${email}"`, limit:1 });
    const found = search.data?.[0];
    if (found) custId = found.id;
    else {
      const created = await stripe.customers.create({ email });
      custId = created.id;
    }
  }
  const c = await stripe.customers.retrieve(custId);
  const current = Number(c?.metadata?.cm_minutes || 0) || 0;
  const next = current + add;
  await stripe.customers.update(custId, {
    metadata:{
      ...(c.metadata||{}),
      cm_minutes: String(next),
      cm_last_credit: String(add),
      cm_last_ts: String(Date.now())
    }
  });
  return {ok:true, minutes:add, total:next, customerId:custId};
}

async function sendEmail(to, minutes, variants){
  if (!resend || !MAIL_FROM || !to) return;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.length
        ? variants.map(v=>`<p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px;">${v}</p>`).join('')
        : `<p>Nessuna scusa generata.</p>`}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
      <p style="font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
    </div>`;
  try{
    await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
  }catch(e){}
}

function buildExcusesFallback(skuTag){
  const v = [
    `Mi è entrato un imprevisto serio e sto riorganizzando. Arrivo più tardi; ti aggiorno entro sera.`,
    `Linea/connessione KO proprio ora; sto risolvendo e ti scrivo appena riparte.`,
    `Mi blocca una situazione imprevista: non voglio darti buca. Ti mando un nuovo orario affidabile a breve.`
  ];
  if ((skuTag||'').toLowerCase().includes('riunione'))
    v[0] = `Riunione inattesa sta sforando. Chiudo il prima possibile e ti aggiorno a breve.`;
  return v;
}

async function sendWhatsApp(toE164, text){
  if (!twilio || !twilioFromWa || !toE164) return {ok:false, reason:'twilio_not_configured'};
  try{
    await twilio.messages.create({ from: twilioFromWa, to: `whatsapp:${toE164}`, body: text });
    return {ok:true};
  }catch(err){
    return {ok:false, reason: String(err?.message||'wa_error')};
  }
}

exports.handler = async (event)=>{
  try{
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return j(400,{ error:'missing_signature' });

    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stEvent = stripe.webhooks.constructEvent(event.body, sig, whSecret);

    if (stEvent.type !== 'checkout.session.completed'){
      return j(200, { received:true, ignored: stEvent.type });
    }

    const session = stEvent.data.object; // Checkout Session
    if (!session || session.mode !== 'payment'){
      return j(200, { received:true, ignored:'not_payment_mode' });
    }

    // INFO UTENTE
    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return j(200, { ok:true, ignored:'no_email' });

    const customerId = session.customer || null;

    // LINE ITEMS → minuti (anche con promo 0€)
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit:100, expand:['data.price'] });
    let minutes = 0;
    let skuTag = '';
    for (const li of items.data){
      minutes += minutesForLineItem(li);
      if (!skuTag) skuTag = li?.price?.lookup_key || '';
    }

    // Genera scuse (se hai la funzione ai-excuse in piedi la puoi chiamare; qui fallback sicuro)
    let variants = [];
    try{
      const r = await fetch(`${(process.env.SITE_URL||'https://colpamia.com')}/.netlify/functions/ai-excuse`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ need: skuTag || 'ritardo', style:'neutro', persona:'generico', locale:'it-IT', maxLen:300 })
      });
      const data = await r.json().catch(()=> ({}));
      variants = (data?.variants || [])
        .map(x => String(x?.whatsapp_text || x?.sms || '').trim())
        .filter(Boolean)
        .slice(0,3);
    }catch{}
    if (!variants.length) variants = buildExcusesFallback(skuTag);

    // Accredita minuti sul Customer (anche se total=0: se 0 non aggiorna)
    let credit = {ok:false, minutes:0};
    if (minutes>0){
      credit = await addMinutesToCustomer(customerId, email, minutes);
    }

    // Email
    await sendEmail(email, minutes, variants);

    // WhatsApp (se fornito)
    const phone =
      session.customer_details?.phone ||
      (Array.isArray(session.custom_fields) ? (session.custom_fields.find(x=>x?.key==='phone')?.text?.value || '') : '');
    if (phone){
      const clean = phone.replace(/[^\d+]/g,'');
      const waText = [
        'La tua Scusa (3 varianti):',
        ...variants.map((v,i)=>`${i+1}) ${v}`),
        '',
        minutes>0 ? `(+${minutes} min accreditati su COLPA MIA)` : ''
      ].join('\n');
      await sendWhatsApp(clean.startsWith('+')?clean:`+${clean}`, waText);
    }

    // (facoltativo) marca la session come processata per idempotenza leggera
    try{ await stripe.checkout.sessions.update(session.id, { metadata:{ ...(session.metadata||{}), cmCredited:'true' } }); }catch{}

    return j(200, { ok:true, minutes, email, customerId: credit.customerId || customerId, payment_status: session.payment_status });

  }catch(err){
    return j(500, { error: String(err?.message || 'webhook_error') });
  }
};
