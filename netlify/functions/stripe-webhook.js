// stripe-webhook.js — mantiene flusso attuale: accredito minuti, 3 varianti, email, WhatsApp.
// NOVITÀ: le scuse arrivano da ai-excuse che usa i 3 modelli base.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const fetchFn = (...a) => fetch(...a);

// Env
const RESEND_KEY  = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL    = (process.env.SITE_URL || '').replace(/\/+$/, '');
const TW_SID      = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN    = (process.env.TWILIO_AUTH_TOKEN  || '').trim();
const TW_FROM_WA  = (process.env.TWILIO_FROM_WA     || '').trim();
const DEF_CC      = (process.env.DEFAULT_COUNTRY_CODE || 'IT').toUpperCase();

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

// Utils
const pick = (x, p, d = null) => { try { return p.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), x) ?? d; } catch { return d; } };
function parseRules(){ try{ return JSON.parse(process.env.PRICE_RULES_JSON || '{}'); } catch{ return {}; } }

// SKU -> kind per ai-excuse
function skuToKind(sku){
  const x = String(sku||'').toUpperCase();
  if (x.includes('RIUNIONE')) return 'riunione';
  if (x.includes('TRAFFICO')) return 'traffico';
  if (x.includes('CONS') || x.includes('CONN')) return 'connessione';
  if (x.includes('DELUXE')) return 'deluxe';
  if (x.includes('TRIPLA')) return 'tripla';
  return 'base';
}

// Minuti: PRICE_RULES_JSON → fallback a metadata su Price/Product
async function minutesFromLineItems(session){
  const rules = parseRules();
  const items = await stripe.checkout.sessions
    .listLineItems(session.id, { limit: 100, expand: ['data.price.product'] })
    .catch(() => ({ data: [] }));

  let sum = 0;
  for (const li of (items.data || [])){
    const qty = li?.quantity || 1;
    const priceId = li?.price?.id;

    if (priceId && rules[priceId]) {
      sum += Number(rules[priceId].minutes || 0) * qty;
      continue;
    }
    const m1 = Number(pick(li, 'price.metadata.minutes', 0)) || 0;
    const m2 = Number(pick(li, 'price.product.metadata.minutes', 0)) || 0;
    sum += (m1 || m2) * qty;
  }
  return sum;
}

// Normalizza telefono: +39…, 0039…, 39…, 347…
function normalizePhone(raw){
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s+/g,'').replace(/^whatsapp:/i,'');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+') && /^\d{6,15}$/.test(s)) {
    if (DEF_CC === 'IT') {
      if (/^3\d{8,11}$/.test(s)) s = '+39' + s;
      else if (s.startsWith('39')) s = '+' + s;
    }
  }
  s = s.replace(/[^\d+]/g,'');
  return /^\+\d{6,15}$/.test(s) ? s : '';
}

// Estrai numero: campo ufficiale + custom_fields (phone/whatsapp/wa/telefono)
function getWhatsAppNumber(session){
  const candidates = [];
  const cPhone = pick(session, 'customer_details.phone', '');
  if (cPhone) candidates.push(cPhone);

  const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  for (const cf of cfs){
    const key   = String(cf?.key || '').toLowerCase();
    const label = String(cf?.label?.custom || '').toLowerCase();
    if (
      key.includes('phone') || key.includes('whatsapp') || key === 'wa' ||
      key.includes('telefono') || label.includes('whatsapp') || label.includes('telefono')
    ){
      const val = String(cf?.text?.value || '').trim();
      if (val) candidates.push(val);
    }
  }
  for (const raw of candidates){
    const norm = normalizePhone(raw);
    if (norm) return norm;
  }
  return '';
}

// WhatsApp via Twilio (Body semplice, invariato)
async function sendWhatsApp(toE164, text){
  if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok:false, reason:'no_twilio_env' };
  const url  = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const body = new URLSearchParams({
    From: TW_FROM_WA,                // es. "whatsapp:+14155238886" o il tuo numero WA
    To:   `whatsapp:${toE164}`,
    Body: text.slice(0, 1200)
  }).toString();

  const r = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')
    },
    body
  });

  const data = await r.json().catch(() => ({}));
  if (r.ok && !data.error_code) return { ok:true, sid:data.sid || null, data };
  const reason = data?.message || data?.error_message || `http_${r.status}`;
  return { ok:false, reason, data };
}

// Email via Resend
async function sendEmail(to, subject, html){
  if (!RESEND_KEY) return { ok:false, reason:'no_resend_env' };
  const r = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from:'COLPA MIA <onboarding@resend.dev>', to:[to], subject, html })
  });
  const data = await r.json().catch(() => ({}));
  return { ok:r.ok, data };
}

// 3 varianti dai modelli (ai-excuse)
async function getExcuses(kind, need, style, locale){
  const url = `${SITE_URL}/.netlify/functions/ai-excuse`;
  const r = await fetchFn(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ kind, need, style, locale, maxLen: 320 })
  });
  const data = await r.json().catch(() => ({}));
  const arr = Array.isArray(data?.variants) ? data.variants.slice(0,3) : [];
  return arr.map(v => String(v.whatsapp_text || '').trim()).filter(Boolean);
}

// Webhook
exports.handler = async (event) => {
  // Firma
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
    // Session
    const session = await stripe.checkout.sessions.retrieve(obj.id, { expand: ['total_details.breakdown'] });

    const email   = String(pick(session, 'customer_details.email', '') || '').toLowerCase().trim();
    const locale  = String(session?.locale || 'it-IT');
    const minutes = await minutesFromLineItems(session);

    // Numero WA
    const phoneE164 = getWhatsAppNumber(session);

    // kind da SKU (client_reference_id) + need da custom_fields
    const kind = skuToKind(session?.client_reference_id || '');
    let need = '';
    for (const cf of (Array.isArray(session?.custom_fields) ? session.custom_fields : [])){
      if (String(cf?.key||'') === 'need' && cf?.text?.value) { need = String(cf.text.value); break; }
    }

    // Varianti
    const variants = await getExcuses(kind, need, 'neutro', locale);
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

    // Metadata su PaymentIntent (se esiste)
    if (session.payment_intent){
      const meta = {
        minutesCredited: String(minutes),
        excusesCount: String(safeVariants.length),
        colpamiaEmailSent: emailSent ? 'true' : 'false',
        colpamiaWaStatus: waStatus,
      };
      if (email) meta.customerEmail = email;
      if (phoneE164) meta.customerPhoneE164 = phoneE164;

      try { await stripe.paymentIntents.update(session.payment_intent, { metadata: meta }); } catch {}
    }

    return j(200, { ok:true, minutes, emailSent, waStatus, variants: safeVariants.length, kind });
  }catch(e){
    return j(500, { error:'webhook_error', detail:String(e?.message||e) });
  }
};
