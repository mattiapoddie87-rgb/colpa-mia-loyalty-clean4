// netlify/functions/stripe-webhook.js
// Accredita minuti (anche con promo 100%), genera 3 varianti coerenti col CONTEX,
// invia WhatsApp + Email, e persiste il saldo sul Customer.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/, '');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim(); // es. whatsapp:+14155238886

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

function parseRules(){ try{ return JSON.parse(process.env.PRICE_RULES_JSON || '{}'); } catch{ return {}; } }
const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; } catch{ return d; } };

async function minutesFromLineItems(session){
  const rules = parseRules();
  const items = await stripe.checkout.sessions
    .listLineItems(session.id,{ limit:100, expand:['data.price.product'] })
    .catch(()=>({data:[]}));
  let sum = 0;

  for (const li of (items.data || [])) {
    const qty = li?.quantity || 1;
    const priceId = li?.price?.id;

    // 1) regola esplicita per priceId in PRICE_RULES_JSON
    if (priceId && rules[priceId]) {
      sum += Number(rules[priceId].minutes || 0) * qty;
      continue;
    }
    // 2) metadata.minutes su price o product
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

async function sendWhatsApp(toNumber, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'no_twilio' };
  if (!toNumber || !/^\+\d{6,15}$/.test(toNumber)) return { ok:false, reason:'bad_phone' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({
    From: TW_FROM_WA,
    To:   `whatsapp:${toNumber}`,
    Body: text
  }).toString();

  const r = await fetch(url, {
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

async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend' };
  const r = await fetch('https://api.resend.com/emails', {
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
  // richiama la function locale per generare 3 varianti
  const url = `${SITE_URL}/.netlify/functions/ai-excuse`;
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ need, persona, style, locale, maxLen:320 })
  });
  const data = await r.json().catch(()=> ({}));
  const arr = Array.isArray(data?.variants) ? data.variants : [];
  // normalizza in array di stringhe pulite
  return arr.map(v => String(v?.whatsapp_text || v?.sms || v?.text || '').trim())
            .filter(Boolean).slice(0,3);
}

exports.handler = async (event) => {
  // verifica firma Stripe
  const sig = event.headers['stripe-signature'];
  try{
    const evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    if (evt.type !== 'checkout.session.completed') {
      return j(200, { ok:true, ignored:true });
    }

    // session completa (include customer_details, custom_fields)
    const session = await stripe.checkout.sessions.retrieve(evt.data.object.id);

    const email = (session?.customer_details?.email || '').trim().toLowerCase();
    let   phone = (session?.customer_details?.phone || '').trim();

    // estrai CONTEX/phone da custom_fields
    let need = '';
    for (const cf of (session.custom_fields || [])) {
      const key = String(cf?.key || '').toLowerCase();
      if (!phone && key === 'phone' && cf?.text?.value) phone = String(cf.text.value).trim();
      if (key === 'need'  && cf?.text?.value) need = String(cf.text.value).trim();
    }
    if (!need) need = `SKU=${session?.client_reference_id || ''}. Genera scuse credibili e realistiche.`;

    // minuti riconosciuti (vale anche con no_payment_required)
    const minutes = await minutesFromLineItems(session);

    // 3 varianti coerenti col contesto
    const variants = (await getExcuses(need, 'generico', 'neutro', session?.locale || 'it-IT'))
                      .map(v => v.slice(0,320));
    const V = variants.slice(0,3);

    // WhatsApp: solo la prima
    let waSent = false;
    if (V[0] && phone) {
      const wa = await sendWhatsApp(
        phone,
        `COLPA MIA — La tua scusa\n\n${V[0]}\n\n(+${minutes} min accreditati sul wallet)`
      );
      waSent = !!wa.ok;
    }

    // Email: tutte e 3
    let emailSent = false;
    if (email) {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.45;color:#111">
          <h2 style="margin:0 0 10px">La tua scusa</h2>
          <ul>${V.map(x=>`<li>${x}</li>`).join('')}</ul>
          <p style="margin-top:14px;color:#444">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
        </div>`;
      const em = await sendEmail(email, 'La tua Scusa — COLPA MIA', html);
      emailSent = !!em.ok;
    }

    // Metadati sul PaymentIntent (retro-compatibilità con vecchio wallet)
    if (session.payment_intent) {
      try {
        await stripe.paymentIntents.update(session.payment_intent, {
          metadata: {
            minutesCredited: String(minutes),
            excusesCount: String(V.length),
            customerEmail: email || '',
            colpamiaEmailSent: emailSent ? 'true' : 'false',
            colpamiaWaStatus: waSent ? 'sent' : 'skip',
          }
        });
      } catch {}
    }

    // Persisti saldo sul Customer (copre promo 100% e guest collegati)
    if (session.customer && minutes > 0) {
      try {
        const cust = await stripe.customers.retrieve(session.customer);
        const cur = Number(cust?.metadata?.wallet_minutes || 0) || 0;
        await stripe.customers.update(session.customer, {
          metadata: {
            wallet_minutes: String(cur + minutes),
            wallet_last_session: session.id
          }
        });
      } catch {}
    }

    return j(200, { ok:true, minutes, emailSent, waSent, variants: V.length });
  }catch(err){
    return j(400, { error:'invalid_or_processing_error', detail:String(err?.message || err) });
  }
};
