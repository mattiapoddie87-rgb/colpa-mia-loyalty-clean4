// netlify/functions/stripe-webhook.js
// Webhook Stripe: accredita minuti, genera scusa (email+WhatsApp), idempotente.

const Stripe = require('stripe');
const { Resend } = require('resend');

// Twilio è opzionale: invio solo se presenti le credenziali
let twilioClient = null;
function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  if (!twilioClient) twilioClient = require('twilio')(sid, tok);
  return twilioClient;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const RULES = safeJson(process.env.PRICE_RULES_JSON) || {};
const EMAIL_ALIASES = safeJson(process.env.EMAIL_ALIASES_JSON) || {};
const DEFAULT_CC = (process.env.DEFAULT_COUNTRY_CODE || '').trim(); // es. +39

// -------------------- util --------------------
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function toInt(x) { const n = parseInt(x, 10); return isNaN(n) ? 0 : n; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Escape per HTML
function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Normalizza email con alias (typo ecc.)
function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  if (EMAIL_ALIASES[e]) return EMAIL_ALIASES[e].toLowerCase();
  return e;
}

// Normalizza telefono in E.164 (+prefisso)
function normalizePhone(raw) {
  let p = String(raw || '').trim();
  if (!p) return null;
  // se ha già il + lo teniamo così
  if (p.startsWith('+')) return p;
  // se non ha il + ma è pieno di spazi/punti, puliscilo
  p = p.replace(/[^\d]/g, '');
  if (!p) return null;
  if (DEFAULT_CC && !p.startsWith('+')) return DEFAULT_CC + p;
  return '+' + p;
}

// -------------------- generatore testi (3 varianti) --------------------
function buildExcuse(kind = 'base', need = '', minutes = 0) {
  const clean = (s) => (s || '').trim();

  // Varianti per tipologia (senza "(base)")
  const variantsMap = {
    base: [
      'Mi dispiace, ho avuto un imprevisto. Arrivo appena possibile.',
      'Scusa il ritardo, sto gestendo un contrattempo. Ti aggiorno tra poco.',
      'Ti chiedo pazienza: si è presentata una situazione imprevista.',
    ],
    riunione: [
      'Sono bloccato in una riunione che si è allungata oltre il previsto. Arrivo appena posso.',
      'Call più lunga del previsto: sto chiudendo e mi rimetto in movimento subito.',
      'Ultimo punto della riunione, sto per uscire e recupero subito.',
    ],
    connessione: [
      'Problemi di connessione: la rete va e viene. Riprendo appena si stabilizza.',
      'Il Wi-Fi è down in ufficio; sto passando in hotspot per ripartire.',
      'Linea instabile qui: qualche minuto e torno operativo.',
    ],
    deluxe: [
      'Mi è stato richiesto un intervento urgente: recupero quanto prima con priorità.',
      'Sto gestendo una criticità imprevista: appena rientra sotto controllo arrivo.',
      'Devo chiudere un imprevisto importante, poi rientro subito nei tempi.',
    ],
    tripla: [
      'Grazie per l’acquisto: attivo subito e recupero in tre slot come concordato.',
      'Ho pianificato tre sessioni brevi per recuperare al meglio.',
      'Procedo a step rapidi: ti aggiorno a chiusura di ogni breve slot.',
    ],
  };

  const list = variantsMap[kind] || variantsMap.base;
  const bulletsTxt = list.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const bulletsHtml = list.map(x => `<li>${x}</li>`).join('');

  const ctx = clean(need) ? clean(need) : '';
  const subject = 'La tua Scusa è pronta ✅';

  const emailHtml = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;color:#0b0d12">
    <h2 style="margin:0 0 8px 0">La tua Scusa è pronta ✅</h2>
    <p style="margin:0 0 12px 0">Hai ricevuto <b>${minutes}</b> minuti nel tuo wallet.</p>
    ${ctx ? `<p style="margin:0 0 12px 0"><b>Contesto:</b> ${escapeHtml(ctx)}</p>` : ''}
    <p style="margin:0 0 6px 0">Scegli quella che preferisci:</p>
    <ul style="padding-left:18px;margin:0 0 12px 0">${bulletsHtml}</ul>
    <p style="opacity:.8;margin:16px 0 0 0">Grazie da COLPA MIA.</p>
  </div>`;

  const waText =
`La tua Scusa è pronta ✅
Hai ricevuto ${minutes} minuti nel tuo wallet.
${ctx ? `\nContesto: ${ctx}\n` : ''}

Scegli quella che preferisci:
${bulletsTxt}

Grazie da COLPA MIA.`;

  return { subject, emailHtml, waText };
}

// -------------------- calcolo minuti + tipo scusa --------------------
async function getMinutesAndKind(sessionId) {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100,
    expand: ['data.price.product'],
  });

  let tot = 0;
  let chosenKind = null;

  for (const li of items.data) {
    const q = li.quantity || 1;
    const price = li.price || {};
    const product = price.product || {};
    const priceId = price.id;

    // 1) Regole da ENV (prioritarie)
    if (priceId && RULES[priceId]) {
      const r = RULES[priceId];
      const mins = toInt(r.minutes);
      if (mins > 0) {
        tot += mins * q;
        if (!chosenKind && r.excuse) chosenKind = String(r.excuse).trim();
        continue;
      }
    }

    // 2) Fallback metadata.minutes su price/product
    const m1 = toInt(price.metadata && price.metadata.minutes);
    const m2 = toInt(product.metadata && product.metadata.minutes);
    const mins = m1 || m2 || 0;
    tot += mins * q;

    // nessun tipo specifico => resta null (finirà su "base")
  }

  if (!chosenKind) chosenKind = 'base';
  return { minutes: tot, kind: chosenKind };
}

// -------------------- estrazione campi dalla sessione --------------------
function extractNeedFromSession(s) {
  // custom_fields (Checkout) → chiave "need"
  const cf = Array.isArray(s.custom_fields) ? s.custom_fields : [];
  const fld = cf.find(x => (x.key || '').toLowerCase() === 'need');
  let val = null;

  if (fld && fld.text && typeof fld.text.value === 'string') val = fld.text.value;
  // fallback
  if (!val && s.metadata && s.metadata.need) val = s.metadata.need;

  return String(val || '').trim();
}

function extractPhoneFromSession(s) {
  let p =
    (s.customer_details && s.customer_details.phone) ||
    (s.shipping_address_collection && s.shipping_address_collection.phone) ||
    (s.metadata && s.metadata.phone) ||
    null;
  return normalizePhone(p);
}

function extractEmailFromSession(s) {
  const e =
    (s.customer_details && s.customer_details.email) ||
    s.customer_email ||
    (s.metadata && s.metadata.email) ||
    null;
  return normalizeEmail(e);
}

// -------------------- handler webhook --------------------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Processiamo SOLO checkout.session.completed (pagato)
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  const s = stripeEvent.data.object; // Checkout Session
  if (!s || s.payment_status !== 'paid') {
    return { statusCode: 200, body: 'not paid' };
  }

  try {
    const piId = String(s.payment_intent || '');
    if (!piId) return { statusCode: 200, body: 'no payment_intent' };

    const pi = await stripe.paymentIntents.retrieve(piId);

    // Idempotenza: se già accreditato, esci
    if (pi.metadata && pi.metadata.colpamiaCredited === 'true') {
      // ma se non abbiamo inviato ancora email/wa, possiamo inviarle comunque
      // (non strettamente necessario)
    }

    // Email & telefono
    const email = extractEmailFromSession(s);
    const phone = extractPhoneFromSession(s);

    // Contesto / esigenza
    const need = extractNeedFromSession(s);

    // Calcolo minuti e tipo
    const { minutes, kind } = await getMinutesAndKind(s.id);
    if (minutes <= 0) {
      // non c'è nulla da accreditare: chiudi comunque OK
      return { statusCode: 200, body: 'no minutes' };
    }

    // Accredito nel tuo sistema (se presente una function locale)
    try {
      const wallet = require('./wallet'); // facoltativo
      if (wallet && typeof wallet.creditMinutes === 'function' && email) {
        await wallet.creditMinutes(email, minutes, { source: 'stripe-webhook', session_id: s.id, payment_intent: piId });
      }
    } catch (_) { /* nessun wallet locale, ignora */ }

    // Aggiorna idempotenza su Stripe
    await stripe.paymentIntents.update(piId, { metadata: { ...(pi.metadata || {}), colpamiaCredited: 'true' } });

    // Genera contenuti messaggio (email + WhatsApp) coerenti
    const { subject, emailHtml, waText } = buildExcuse(kind, need, minutes);

    // Invia EMAIL (se possibile)
    if (resend && email) {
      try {
        await resend.emails.send({
          from: process.env.MAIL_FROM || 'COLPA MIA <no-reply@colpamia.com>',
          to: email,
          subject,
          html: emailHtml,
        });
        await stripe.paymentIntents.update(piId, { metadata: { ...(pi.metadata || {}), colpamiaEmailSent: 'true' } });
      } catch (_) { /* logga se vuoi */ }
    }

    // Invia WhatsApp (se possibile)
    const tw = getTwilio();
    if (tw && phone && process.env.TWILIO_FROM_WA) {
      try {
        await tw.messages.create({
          from: process.env.TWILIO_FROM_WA,       // "whatsapp:+14155238886" (o il tuo WABA)
          to:   `whatsapp:${phone}`,               // "whatsapp:+39..."
          body: waText,
        });
        // Piccola attesa per evitare race su metadata
        await sleep(150);
        const pi2 = await stripe.paymentIntents.retrieve(piId);
        await stripe.paymentIntents.update(piId, { metadata: { ...(pi2.metadata || {}), colpamiaWASent: 'true' } });
      } catch (_) { /* logga se vuoi */ }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    return { statusCode: 500, body: `Internal Error: ${err.message || err}` };
  }
};
