// netlify/functions/stripe-webhook.js
// - Accredita i minuti anche con guest checkout (promo code ok)
// - Scrive su PaymentIntent.metadata: minutesCredited, customerEmail, excusesCount, colpamiaEmailSent, colpamiaWaStatus
// - Invia email (Resend) con 3 varianti + WhatsApp (Twilio) con le 3 varianti (prima riuscita)

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const fetchFn = (...a) => fetch(...a);

const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/, '');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim(); // es. +14155238886 o whatsapp:+14155238886

const CORS = { 'Access-Control-Allow-Origin':'*' };
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

function parseRules(){ try{ return JSON.parse(process.env.PRICE_RULES_JSON || '{}'); } catch{ return {}; } }
const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; } catch{ return d; } };

async function minutesFromLineItems(session){
  const rules = parseRules();
  const items = await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum = 0;

  for (const li of (items.data || [])){
    const qty = li?.quantity || 1;
    const priceId = li?.price?.id;

    // 1) mappa per priceId se presente in PRICE_RULES_JSON
    if (priceId && rules[priceId]) {
      sum += Number(rules[priceId].minutes || 0) * qty;
      continue;
    }
    // 2) metadata su price o product
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

// ---------- WhatsApp helpers (FIX) ----------

function normalizePhone(raw){
  if (!raw) return '';
  let s = String(raw).replace(/[^\d+]/g,'');    // rimuove spazi e segni
  if (s.startsWith('00')) s = '+' + s.slice(2); // 00 -> +
  // default IT mobile: 3xxxxxxxxx senza prefisso
  if (!s.startsWith('+') && /^3\d{8,10}$/.test(s)) s = '+39' + s;
  return s;
}

function getPhonesFromSession(session){
  const out = [];
  const cd = session?.customer_details || {};
  if (cd.phone) out.push(cd.phone);

  try {
    for (const cf of (session.custom_fields || [])) {
      if (String(cf.key||'').toLowerCase()==='phone' && cf?.text?.value) {
        out.push(cf.text.value);
      }
    }
  } catch {}

  // normalizza + deduplica + valida E.164
  return [...new Set(out
    .map(normalizePhone)
    .filter(p => /^\+\d{6,15}$/.test(p)))];
}

async function sendWhatsApp(toNumber, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'no_twilio' };

  const from = TW_FROM_WA.startsWith('whatsapp:') ? TW_FROM_WA : ('whatsapp:' + TW_FROM_WA);
  const to   = toNumber.startsWith('whatsapp:')   ? toNumber   : ('whatsapp:' + toNumber);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ From: from, To: to, Body: text }).toString();

  const r = await fetchFn(url, {
    method:'POST',
    headers: {
      'Content-Type':'application/x-www-form-urlencoded',
      'Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')
    },
    body
  });
  const data = await r.json().catch(()=> ({}));
  return { ok: r.ok, data };
}

// ---------- Email & AI ----------

async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend' };
  const r = await fetchFn('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      from: 'COLPA MIA <onboarding@resend.dev>',
      to: [to],
      subject,
      html
    })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

async function getExcuses(need, persona, style, locale){
  // usa la function ai-excuse per generare sempre 3 varianti
  const url = `${SITE_URL}/.netlify/functions/ai-excuse`;
  const r = await fetchFn(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ need, persona, style, locale, maxLen:320 })
  });
  const data = await r.json().catch(()=> ({}));
  const arr = Array.isArray(data?.variants) ? data.variants.slice(0,3) : [];
  return arr.map(v => String(v.whatsapp_text||'').trim()).filter(Boolean);
}

// ---------- Webhook ----------

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let type, obj;

  try{
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const evt = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    type = evt.type;
    obj  = evt.data.object;
  }catch(err){
    return j(400, { error:'invalid_signature', detail:String(err?.message||err) });
  }

  if (type !== 'checkout.session.completed') {
    return j(200, { ok:true, ignored:true });
  }

  try{
    // session completa (serve customer_details + custom_fields)
    const session = await stripe.checkout.sessions.retrieve(obj.id, { expand: ['total_details.breakdown'] });

    const email   = (session?.customer_details?.email || '').toLowerCase().trim();
    const minutes = await minutesFromLineItems(session);

    // genero 3 varianti
    const need     = 'Genera una scusa credibile, tono ' + (session?.locale || 'it-IT');
    let variants   = await getExcuses(need, 'generico', 'neutro', session?.locale || 'it-IT'); // <= array [1..3]
    if (!variants.length) variants = ['Imprevisto in corso, ti aggiorno a breve.'];            // fallback
    while (variants.length < 3) variants.push(variants[0]);                                    // garantisce 3 righe

    // -------- WhatsApp --------
    const phones = getPhonesFromSession(session);
    let waSent = false;

    if (phones.length){
      const message =
        `La tua Scusa (3 varianti):\n` +
        `1) ${variants[0]}\n` +
        `2) ${variants[1]}\n` +
        `3) ${variants[2]}\n\n` +
        `(+${minutes} min accreditati su COLPA MIA)`;

      for (const p of phones){
        const wa = await sendWhatsApp(p, message);
        if (wa.ok){ waSent = true; break; }
      }
    }

    // -------- Email --------
    let emailSent = false;
    if (email) {
      const bullet = variants.map(v => `<li>${v}</li>`).join('');
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.45;color:#111">
          <h2 style="margin:0 0 10px">La tua scusa</h2>
          <ol><li>${variants[0]}</li><li>${variants[1]}</li><li>${variants[2]}</li></ol>
          <p style="margin-top:14px;color:#444">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
        </div>`;
      const em = await sendEmail(email, 'La tua Scusa — COLPA MIA', html);
      emailSent = !!em.ok;
    }

    // -------- Metadata sul PaymentIntent --------
    if (session.payment_intent) {
      const meta = {
        minutesCredited: String(minutes),
        excusesCount: String(variants.length || 0),
        colpamiaEmailSent: emailSent ? 'true' : 'false',
        colpamiaWaStatus: waSent ? 'sent' : 'skip'
      };
      if (email) meta.customerEmail = email;
      try { await stripe.paymentIntents.update(session.payment_intent, { metadata: meta }); } catch {}
    }

    return j(200, { ok:true, minutes, emailSent, waSent, variants: (variants || []).length });
  }catch(err){
    return j(500, { error:'webhook_error', detail:String(err?.message||err) });
  }
};
