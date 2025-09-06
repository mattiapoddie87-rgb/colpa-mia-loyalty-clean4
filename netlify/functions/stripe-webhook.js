// netlify/functions/stripe-webhook.js
// Accredito minuti + invio scuse (email + WhatsApp) al completamento del checkout

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resendKey = (process.env.RESEND_API_KEY || '').trim();
const resend = resendKey ? new Resend(resendKey) : null;
const MAIL_FROM =
  process.env.RESEND_FROM ||
  process.env.MAIL_FROM ||
  'COLPA MIA <onboarding@resend.dev>';

const twSid   = process.env.TWILIO_ACCOUNT_SID || '';
const twTok   = process.env.TWILIO_AUTH_TOKEN || '';
const twFrom  = process.env.TWILIO_FROM_WA || '';         // es. "whatsapp:+14155238886"
const defaultCC = (process.env.DEFAULT_COUNTRY_CODE || '+39').trim();
const twilio  = (twSid && twTok) ? require('twilio')(twSid, twTok) : null;

const ORIGIN  = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' };
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

function parseEnvJSON(k){ try{ return JSON.parse(process.env[k]||'{}'); }catch{ return {}; }}

// ---- Mappa minuti per SKU (obbligatoria). Esempio consigliato in Netlify:
// PRICE_RULES_JSON = {"SCUSA_ENTRY":{"minutes":10},"SCUSA_BASE":{"minutes":10},"SCUSA_TRIPLA":{"minutes":30},"SCUSA_DELUXE":{"minutes":60},"CONS_KO":{"minutes":30},"RIUNIONE":{"minutes":15},"TRAFFICO":{"minutes":20}}
const RULES = parseEnvJSON('PRICE_RULES_JSON'); // { SKU: {minutes, ...} }

function onlyDigits(s){ return String(s||'').replace(/[^\d]/g,''); }
function isE164(s){ return /^\+\d{6,15}$/.test(String(s||'')); }
function asWhatsApp(toRaw){
  let to = String(toRaw||'').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(to)) return to;
  if (isE164(to)) return `whatsapp:${to}`;
  let d = onlyDigits(to);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = defaultCC.replace('+','');
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}

// --------- AI scuse (via funzione interna ai-excuse)
async function getExcuses(need, personaTag){
  try{
    const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        need: String(need||'').slice(0,300) || 'ritardo',
        style: 'neutro',
        persona: String(personaTag||'generico'),
        locale: 'it-IT',
        maxLen: 300
      })
    });
    const data = await r.json().catch(()=> ({}));
    let arr = Array.isArray(data?.variants) ? data.variants : [];
    arr = arr
      .map(v => ({
        sms: String(v?.sms||'').trim(),
        whatsapp_text: String(v?.whatsapp_text||v?.sms||'').trim()
      }))
      .filter(v => v.whatsapp_text);
    if (arr.length) return arr.slice(0,3);

  }catch{}
  // fallback
  const fallback = [
    'Mi scuso: imprevisto ora, sto riorganizzando. Appena ho chiaro l’orario ti scrivo (entro sera).',
    'Sto chiudendo un’urgenza e temo un piccolo ritardo. Ti aggiorno a breve con un orario realistico.',
    'Mi dispiace, ho un imprevisto in corso. Minimizzare il ritardo è la priorità: appena definito, ti mando un nuovo slot.'
  ];
  return fallback.map(t => ({ sms:t, whatsapp_text:t }));
}

// --------- EMAIL
async function sendEmail(to, minutes, variants){
  if (!resend) return false;
  const pills = variants.map(v => `<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${v.whatsapp_text}</p>`).join('');
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
      <h2 style="margin:0 0 12px">La tua scusa</h2>${pills}
      <p style="margin-top:12px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
    </div>`;
  try{
    await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa — COLPA MIA', html });
    return true;
  }catch{ return false; }
}

// --------- WHATSAPP
async function sendWhatsApp(toRaw, variants, minutes){
  if (!twilio || !twFrom) return false;
  const body = [
    'La tua Scusa (3 varianti):',
    ...variants.map((v,i)=> `${i+1}) ${v.whatsapp_text}`),
    '',
    `(+${minutes} min accreditati su COLPA MIA)`
  ].join('\n');
  try{
    await twilio.messages.create({ from: twFrom, to: asWhatsApp(toRaw), body });
    return true;
  }catch{ return false; }
}

// --------- WALLET (metadata sul Customer)
async function addMinutes(customerId, delta){
  if (!customerId || !delta) return 0;
  const c = await stripe.customers.retrieve(customerId);
  const cur = parseInt(c?.metadata?.cm_minutes_total||'0',10) || 0;
  const next = cur + delta;
  await stripe.customers.update(customerId, { metadata: { cm_minutes_total: String(next) } });
  return next;
}

// --------- Estrae minuti dai line items usando SKU/lookup_key
function skuFromLineItem(li, session){
  return String(
    session?.metadata?.sku ||
    li?.price?.lookup_key ||
    li?.price?.product?.metadata?.sku ||
    ''
  ).toUpperCase().trim();
}
function minutesForSKU(sku, qty){
  if (!sku) return 0;
  const rule = RULES[sku] || RULES[String(sku).toUpperCase()];
  const m = parseInt(rule?.minutes||'0',10) || 0;
  return m * (qty||1);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{error:'method_not_allowed'});

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) return j(400,{error:'missing_signature'});
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let ev;
  try{
    ev = stripe.webhooks.constructEvent(event.body, sig, whSecret);
  }catch(err){
    return j(400,{error:`signature_verification_failed: ${err.message}`});
  }

  // Gestiamo solo il completamento del checkout (anche se total = 0 con promo)
  if (ev.type !== 'checkout.session.completed')
    return j(200,{received:true, ignored: ev.type});

  const session = ev.data.object;

  // Idempotenza semplice: se già marcato, stop
  if (session?.metadata?.cmCredited === 'true')
    return j(200,{ok:true, already:true});

  // Email + customer
  const email = String(session?.customer_details?.email || session?.customer_email || '').toLowerCase();
  const customerId = session?.customer || null;

  // Minuti dalle line items (funziona anche con promo 100% / amount_total=0)
  let minutes = 0;
  try{
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand:['data.price.product'] });
    for (const li of items.data){
      const sku = skuFromLineItem(li, session);
      minutes += minutesForSKU(sku, li.quantity || 1);
    }
  }catch{ /* niente */ }

  // Contesto utente per l'AI
  let context = '';
  (Array.isArray(session?.custom_fields) ? session.custom_fields : []).forEach(cf=>{
    if ((cf?.key||'').toLowerCase() === 'need' && cf?.text?.value) context = String(cf.text.value).slice(0,300);
  });

  // Persona (tag) dedotta dallo SKU (primo item)
  let personaTag = '';
  try{
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1, expand:['data.price.product'] });
    const first = items.data?.[0];
    personaTag = skuFromLineItem(first, session).toLowerCase();
  }catch{}

  // Genera 3 varianti (sempre)
  const variants = await getExcuses(context, personaTag);
  if (!variants.length) variants.push({ whatsapp_text:'Imprevisto ora: riorganizzo e ti aggiorno entro sera.' });

  // Accredito minuti (anche con importo 0). Se non ci sono regole o SKU errato -> 0.
  if (minutes > 0 && customerId){
    await addMinutes(customerId, minutes);
  }

  // Email (best effort)
  if (email) await sendEmail(email, minutes, variants);

  // WhatsApp (best effort): prendi il telefono dalla sessione
  const phone =
    session?.customer_details?.phone ||
    (Array.isArray(session?.custom_fields) ? (session.custom_fields.find(cf => (cf.key||'').toLowerCase()==='phone')?.text?.value) : null) ||
    null;
  if (phone) await sendWhatsApp(phone, variants, minutes);

  // Marca la sessione come "già accreditata" (idempotenza)
  try{
    await stripe.checkout.sessions.update(session.id, {
      metadata: { ...(session.metadata||{}), cmCredited:'true', cmMinutes:String(minutes) }
    });
  }catch{}

  return j(200,{ok:true, minutes, email, phone, variants: variants.length});
};
