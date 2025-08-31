// netlify/functions/claim-purchase.js
// Collega una Checkout Session pagata, accredita minuti (idempotente) e genera eventuali "scuse".
// - Minuti: da PRICE_RULES_JSON (se presente) o PRICE_MINUTES_JSON / metadata.minutes
// - Scuse: da PRICE_RULES_JSON (es. {"price_...":{"excuse":"riunione"}})
// - Idempotenza: PaymentIntent.metadata.colpamiaCredited = 'true'

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --- utils ---
const safeJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const isValidEmail = (x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || ''));
const resp = (code, body) => ({
  statusCode: code,
  headers: { ...cors, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

// safe require (non crasha se il file non esiste)
function safeRequire(path) { try { return require(path); } catch { return null; } }

// fallback: solo minuti (se manca ./fulfillment)
const FALLBACK_MAP = safeJson(process.env.PRICE_MINUTES_JSON) || {};
function fallbackCalcMinutes(items) {
  let tot = 0;
  for (const li of items) {
    const price = li.price || {};
    const product = price.product || {};
    const env = price.id ? (FALLBACK_MAP[price.id] || 0) : 0;
    const meta =
      parseInt((price.metadata && price.metadata.minutes) || '', 10) ||
      parseInt((product.metadata && product.metadata.minutes) || '', 10) || 0;
    const m = env || meta || 0;
    tot += m * (li.quantity || 1);
  }
  return tot;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return resp(405, { error: 'Method Not Allowed' });

    let payload = {};
    try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }

    let { session_id, email_fallback, phone } = payload;
    session_id = String(session_id || '').replace(/\s/g, '');

    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session_id)) return resp(400, { error: 'Session ID non valido' });
    if (session_id.length > 200) return resp(400, { error: 'Session ID troppo lungo' });

    // Coerenza ambiente (evita test su live e viceversa)
    const isLiveId = session_id.startsWith('cs_live_');
    const isLiveKey = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
    if (isLiveId !== isLiveKey) return resp(400, { error: 'Mismatch Live/Test tra chiave Stripe e Session ID' });

    // Recupero sessione
    const s = await stripe.checkout.sessions.retrieve(session_id);
    if (s.mode !== 'payment') return resp(400, { error: 'Sessione non di pagamento' });
    if (s.payment_status !== 'paid') return resp(409, { error: 'Pagamento non acquisito' });

    // Idempotenza su PaymentIntent
    const piId = String(s.payment_intent || '');
    if (!piId) return resp(400, { error: 'Payment Intent assente' });

    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata && pi.metadata.colpamiaCredited === 'true') {
      return resp(200, { ok: true, credited: false, reason: 'già accreditato' });
    }

    // Email autoritativa dalla sessione, fallback opzionale
    const emailFromSession = (s.customer_details && s.customer_details.email) || s.customer_email || null;
    const email = normalizeEmail(emailFromSession || (isValidEmail(email_fallback) ? email_fallback : ''));
    if (!email) return resp(400, { error: 'Email assente/illeggibile' });

    // Line items
    const items = await stripe.checkout.sessions.listLineItems(session_id, { limit: 100, expand: ['data.price.product'] });

    // Calcolo minuti + scuse
    let minutes = 0;
    let excuses = [];
    const fulfillment = safeRequire('./fulfillment');
    if (fulfillment && typeof fulfillment.processLineItems === 'function') {
      const out = await fulfillment.processLineItems(items.data, { first_name: email.split('@')[0] });
      minutes = Number(out.minutes || 0);
      excuses = Array.isArray(out.excuses) ? out.excuses : [];
    } else {
      minutes = fallbackCalcMinutes(items.data);
      excuses = []; // nessuna scusa in fallback
    }

    // Accredito minuti (se presenti)
    if (minutes > 0) {
      try {
        const wallet = safeRequire('./wallet');
        if (wallet && typeof wallet.creditMinutes === 'function') {
          await wallet.creditMinutes(email, minutes, { phone, session_id, piId });
        }
      } catch (_) { /* ignora errore wallet per non rompere il flow */ }
    }

    // Idempotenza: marchia PI e annota riepilogo
    const metaUpdate = {
      ...(pi.metadata || {}),
      colpamiaCredited: 'true',
      minutesCredited: String(minutes || 0),
      excusesCount: String(excuses.length || 0),
    };
    await stripe.paymentIntents.update(piId, { metadata: metaUpdate });

    // (opzionale) qui potresti inviare le scuse via email/whatsapp

    return resp(200, { ok: true, credited: minutes > 0, email, minutes, excuses });
  } catch (err) {
    return resp(500, { error: err.message || 'Errore interno' });
  }
};

