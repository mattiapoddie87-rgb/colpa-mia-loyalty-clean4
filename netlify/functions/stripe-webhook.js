// netlify/functions/stripe-webhook.js
// - Usa il CONTENUTO del campo custom "need" del Checkout
// - Passa persona dal PRICE_RULES_JSON (riunione/traffico/deluxe/conn/base/...)
// - Genera SEMPRE 3 varianti (via ai-excuse) e le invia su email + WhatsApp
// - Accredita minuti nel Customer.metadata.wallet_minutes (funziona anche con promo 100%)

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/,'');
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM  = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim(); // es. whatsapp:+14155238886

const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) });
const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } };
function readRules(){ try{ return JSON.parse(process.env.PRICE_RULES_JSON||'{}'); }catch{ return {}; } }

async function listItems(sessionId){
  return await stripe.checkout.sessions.listLineItems(sessionId, { limit:100, expand:['data.price.product'] })
    .then(r=>r.data||[]).catch(()=>[]);
}
function personaFromRules(items, rules){
  for (const li of items){
    const pid = pick(li,'price.id','');
    const tag = pid && rules[pid]?.excuse;
    if (tag) return String(tag);
  }
  return 'generico';
}
function minutesFrom(items, rules){
  let tot=0;
  for (const li of items){
    const q = li.quantity || 1;
    const pid = pick(li,'price.id','');
    if (pid && rules[pid]) { tot += Number(rules[pid].minutes||0)*q; continue; }
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    tot += (m1||m2)*q;
  }
  return tot;
}
function extractNeed(session){
  const arr = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  for (const cf of arr){ if ((cf.key||'').toLowerCase()==='need' && cf?.text?.value) return String(cf.text.value).trim(); }
  return '';
}

async function sendWA(to, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'twilio_not_configured' };
  if (!/^\+\d{6,15}$/.test(String(to||'')))   return { ok:false, reason:'bad_phone' };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ From: TW_FROM_WA, To: `whatsapp:${to}`, Body: text }).toString();
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded',
              'Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64') },
    body
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}
async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend_key' };
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to:[to], subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}
async function generateExcuses(need, persona, locale){
  const url = `${SITE_URL}/.netlify/functions/ai-excuse`;
  const seed = Math.floor(Math.random()*1e9);
  const r = await fetch(url, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ need, persona, style:'neutro', locale, maxLen:320, seed })
  });
  const data = await r.json().catch(()=> ({}));
  const arr = Array.isArray(data?.variants) ? data.variants : [];
  return arr.map(v => String(v?.whatsapp_text||'').trim()).filter(Boolean).slice(0,3);
}
async function incCustomerMinutes(customerId, add){
  if (!customerId || !add) return;
  try{
    const c = await stripe.customers.retrieve(customerId);
    const prev = Number(c?.metadata?.wallet_minutes||0) || 0;
    await stripe.customers.update(customerId, { metadata:{ wallet_minutes: String(prev + add) } });
  }catch{}
}

exports.handler = async (event)=>{
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  let evt;
  try{
    evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(err){
    return j(400,{ error:'invalid_signature', detail:String(err?.message||err) });
  }

  if (evt.type !== 'checkout.session.completed') return j(200,{ ok:true, ignored:true });

  try{
    const session = await stripe.checkout.sessions.retrieve(evt.data.object.id, { expand:['total_details.breakdown'] });
    const rules   = readRules();
    const items   = await listItems(session.id);

    const email   = (session.customer_details?.email || '').toLowerCase().trim();
    const phone   = (session.customer_details?.phone || '').trim();
    const need    = extractNeed(session) || 'Ritardo reale, serve alibi credibile senza dettagli rischiosi.';
    const persona = personaFromRules(items, rules);
    const minutes = minutesFrom(items, rules);
    const locale  = session.locale || 'it-IT';

    // 3 varianti dall'AI (robust)
    const variants = await generateExcuses(need, persona, locale); // array di 1-3
    const v3 = variants.length ? variants : [
      'Imprevisto reale: sto riorganizzando. Ti aggiorno entro le 18 con orario chiaro.',
      'Urgenza improvvisa: riduco il ritardo al minimo. Ti scrivo appena ho visibilità.',
      'Incidente di percorso: preferisco non promettere tempi falsi. Ti aggiorno a breve.'
    ];

    // WhatsApp: inviamo TUTTE E 3 numerate
    let waSent=false;
    if (phone) {
      const waText = 'COLPA MIA — La tua Scusa (3 varianti):\n\n'
        + v3.map((t,i)=>`${i+1}) ${t}`).join('\n\n')
        + (minutes? `\n\n(+${minutes} min accreditati sul wallet)` : '');
      const wa = await sendWA(phone, waText);
      waSent = !!wa.ok;
    }

    // Email: lista puntata
    let emailSent=false;
    if (email) {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 10px">La tua scusa</h2>
          <ol>${v3.map(t=>`<li>${t}</li>`).join('')}</ol>
          ${minutes ? `<p style="margin-top:12px;color:#444">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>`:''}
        </div>`;
      const em = await sendEmail(email, 'La tua Scusa — COLPA MIA', html);
      emailSent = !!em.ok;
    }

    // Accredito wallet anche con promo code (senza PI)
    if (minutes && session.customer) {
      await incCustomerMinutes(session.customer, minutes);
    }

    // Scrivo metadati anche sul PaymentIntent (se esiste)
    if (session.payment_intent) {
      try{
        await stripe.paymentIntents.update(session.payment_intent, {
          metadata: {
            customerEmail: email || '',
            minutesCredited: String(minutes||0),
            excusesCount: String(v3.length||0),
            colpamiaEmailSent: emailSent ? 'true' : 'false',
            colpamiaWaStatus: waSent ? 'sent' : 'skip'
          }
        });
      }catch{}
    }

    return j(200,{ ok:true, minutes, emailSent, waSent, variants: v3.length, persona, usedNeed: need });
  }catch(err){
    return j(500,{ error:'webhook_error', detail:String(err?.message||err) });
  }
};
