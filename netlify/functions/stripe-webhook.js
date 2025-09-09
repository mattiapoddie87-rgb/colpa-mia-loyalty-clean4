// netlify/functions/stripe-webhook.js
// - Accredita minuti su Customer.metadata.cm_wallet_minutes (persistente)
// - Idempotenza: non riaccredita se il PI ha metadata cm_wallet_applied=true
// - Genera 3 varianti, invia Email (Resend) e WhatsApp (Twilio)

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const fetchFn = (...a) => fetch(...a);

// --- Env --------------------------------------------------------------
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/,'');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN  || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA     || '').trim();

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

const pick = (x, p, d = null) => { try { return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null), x) ?? d; } catch { return d; } };
function parseRules(){ try{ return JSON.parse(process.env.PRICE_RULES_JSON || '{}'); } catch{ return {}; } }

// === Helpers ==========================================================
async function minutesFromLineItems(session){
  const rules = parseRules();
  const items = await stripe.checkout.sessions
    .listLineItems(session.id, { limit: 100, expand: ['data.price.product'] })
    .catch(() => ({ data: [] }));

  let sum = 0;
  for (const li of (items.data || [])){
    const qty = li?.quantity || 1;
    const priceId = li?.price?.id;
    if (priceId && rules[priceId]) { sum += Number(rules[priceId].minutes || 0) * qty; continue; }
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

function normalizePhone(raw){
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s+/g,'').replace(/^whatsapp:/i,'');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+') && /^\d{6,15}$/.test(s)) { if (s.startsWith('39')) s = '+' + s; }
  s = s.replace(/[^\d+]/g,'');
  return (/^\+\d{6,15}$/.test(s)) ? s : '';
}

function getWhatsAppNumber(session){
  const cand = [];
  const cPhone = pick(session,'customer_details.phone',''); if (cPhone) cand.push(cPhone);
  const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  for (const cf of cfs){
    const key = String(cf?.key||'').toLowerCase();
    if (key.includes('phone') || key==='whatsapp' || key==='wa'){
      const v = String(cf?.text?.value||'').trim(); if (v) cand.push(v);
    }
  }
  for (const raw of cand){ const n = normalizePhone(raw); if (n) return n; }
  return '';
}

async function sendWhatsApp(toE164, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'no_twilio_env' };
  const url  = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({ From: TW_FROM_WA, To: `whatsapp:${toE164}`, Body: text.slice(0,1200) }).toString();
  const r = await fetchFn(url,{
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64') },
    body
  });
  const data = await r.json().catch(()=> ({}));
  if (r.ok && !data.error_code) return { ok:true, sid:data.sid||null, data };
  const reason = data?.message || data?.error_message || `http_${r.status}`;
  return { ok:false, reason, data };
}

async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend_env' };
  const r = await fetchFn('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from:'COLPA MIA <noreply@colpamia.com>', to:[to], subject, html })
  });
  const data = await r.json().catch(()=> ({}));
  return { ok:r.ok, data };
}

async function getExcuses(need, persona, style, locale){
  const url = `${SITE_URL}/.netlify/functions/ai-excuse`;
  const r = await fetchFn(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ need, persona, style, locale, maxLen:320 }) });
  const data = await r.json().catch(()=> ({}));
  const arr = Array.isArray(data?.variants) ? data.variants.slice(0,3) : [];
  return arr.map(v => String(v.whatsapp_text||'').trim()).filter(Boolean);
}

// --- Wallet: scegli Customer “master” per email, idempotenza su PI ----
async function findMasterCustomerByEmail(email){
  const q = `email:"${email.replace(/"/g,'\\"')}"`;
  const res = await stripe.customers.search({ query: q, limit: 20 }).catch(()=>({data:[]}));
  if (!res.data?.length) return null;
  // prendi il più vecchio come “master”
  res.data.sort((a,b)=> (a.created||0)-(b.created||0));
  return res.data[0];
}

async function creditWalletOnce({ email, customerId, paymentIntentId, minutes }){
  if (!email || !minutes || minutes<=0) return { applied:false, before:0, after:0, master:null };

  // 1) idempotenza: se il PI è già marcato, esci
  let pi = null;
  if (paymentIntentId){
    pi = await stripe.paymentIntents.retrieve(paymentIntentId).catch(()=>null);
    if (pi?.metadata?.cm_wallet_applied === 'true'){
      const master = await findMasterCustomerByEmail(email);
      const before = Number(master?.metadata?.cm_wallet_minutes||0);
      return { applied:false, before, after:before, master };
    }
  }

  // 2) trova/crea il customer master dalla mail
  let master = await findMasterCustomerByEmail(email);
  if (!master){
    master = await stripe.customers.create({ email }).catch(()=>null);
  }
  const before = Number(master?.metadata?.cm_wallet_minutes || 0);
  const after  = before + Number(minutes||0);

  // 3) aggiorna saldo sul master
  try{
    await stripe.customers.update(master.id, { metadata: { cm_wallet_minutes: String(after) } });
  }catch{}

  // 4) marca il PI come applicato
  if (pi && paymentIntentId){
    try{
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          ...(pi.metadata||{}),
          cm_wallet_applied: 'true',
          cm_wallet_customer_id: master.id,
          cm_wallet_before: String(before),
          cm_wallet_after:  String(after)
        }
      });
    }catch{}
  }

  return { applied:true, before, after, master };
}

// --- Webhook ----------------------------------------------------------
exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let type, obj;
  try{
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const ev = stripe.webhooks.constructEvent(event.body, sig, secret);
    type = ev.type;
    obj  = ev.data.object;
  }catch(e){
    return j(400, { error:'invalid_signature', detail:String(e?.message||e) });
  }

  if (type !== 'checkout.session.completed') return j(200, { ok:true, ignored:true });

  try{
    const session = await stripe.checkout.sessions.retrieve(obj.id, { expand: ['total_details.breakdown'] });
    const email   = String(pick(session,'customer_details.email','')||'').toLowerCase().trim();
    const locale  = String(session?.locale || 'it-IT');
    const minutes = await minutesFromLineItems(session);

    // Numero WA dal campo ufficiale o custom_fields
    const phoneE164 = getWhatsAppNumber(session);

    // 3 varianti
    const need = 'Scusa coerente col pacchetto acquistato; tono naturale.';
    const variants = await getExcuses(need, 'cliente', 'neutro', locale);
    const safeVariants = variants.length ? variants : [
      'Imprevisto reale in corso; minimizzo il ritardo e ti scrivo appena ho un orario preciso.',
      'Sto chiudendo un’urgenza: preferisco darti tempi chiari tra poco.',
      'Mi riorganizzo subito: riduco l’attesa e ti tengo allineato a breve.'
    ];

    // WhatsApp
    let waStatus = 'skip:no_phone';
    if (phoneE164) {
      const waText =
        'La tua Scusa (3 varianti):\n' +
        safeVariants.map((v,i)=>`${i+1}) ${v}`).join('\n') +
        `\n\n(+${minutes} min accreditati su COLPA MIA)`;
      const wa = await sendWhatsApp(phoneE164, waText);
      waStatus = wa.ok ? 'sent' : `fail:${wa.reason||'unknown'}`;
    }

    // Email
    let emailSent = false;
    if (email) {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 8px">La tua scusa (3 varianti)</h2>
          <ol style="padding-left:18px">${safeVariants.map(v=>`<li>${v}</li>`).join('')}</ol>
          <p style="margin-top:12px;color:#444">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
        </div>`;
      const em = await sendEmail(email, 'La tua Scusa — COLPA MIA', html);
      emailSent = !!em.ok;
    }

    // Wallet persistente + idempotenza
    let walletBefore=0, walletAfter=0, walletApplied=false;
    if (email){
      const w = await creditWalletOnce({
        email,
        customerId: session.customer || null,
        paymentIntentId: session.payment_intent || null,
        minutes
      });
      walletBefore = w.before; walletAfter = w.after; walletApplied = w.applied;
    }

    // Scrivi metadati PI per diagnosi
    if (session.payment_intent){
      const meta = {
        minutesCredited: String(minutes),
        excusesCount: String(safeVariants.length),
        colpamiaEmailSent: emailSent ? 'true' : 'false',
        colpamiaWaStatus: waStatus,
        walletEmail: email || '',
        walletBefore: String(walletBefore),
        walletAfter:  String(walletAfter)
      };
      try { await stripe.paymentIntents.update(session.payment_intent, { metadata: meta }); } catch {}
    }

    return j(200, { ok:true, minutes, emailSent, waStatus, variants:safeVariants.length, walletBefore, walletAfter, walletApplied });
  }catch(e){
    return j(500, { error:'webhook_error', detail:String(e?.message||e) });
  }
};
