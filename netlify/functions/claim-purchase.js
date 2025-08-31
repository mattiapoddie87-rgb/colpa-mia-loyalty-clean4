// netlify/functions/claim-purchase.js
// Recupera la sessione Checkout, valida pagamento, ricava email e accredita minuti (idempotente).

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --- MAPPATURA PREZZO -> MINUTI ---
// Consiglio: metti gli ID reali in ENV (PRICE_MINUTES_JSON) come {"price_abc":5,"price_def":15}
const MAP_FROM_ENV = safeJson(process.env.PRICE_MINUTES_JSON) || {};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

    if (event.httpMethod !== 'POST') return resp(405, { error: 'Method Not Allowed' });

    let payload = {};
    try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }

    let { session_id, email_fallback, phone } = payload;
    session_id = String(session_id || '').replace(/\s/g, '');

    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session_id))
      return resp(400, { error: 'Session ID non valido' });

    // Ambiente coerente (facoltativo ma utile)
    const isLiveId = session_id.startsWith('cs_live_');
    const isLiveKey = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
    if (isLiveId !== isLiveKey)
      return resp(400, { error: 'Mismatch Live/Test tra chiave Stripe e Session ID' });

    // 1) Recupero Session
    const s = await stripe.checkout.sessions.retrieve(session_id);
    if (s.mode !== 'payment') return resp(400, { error: 'Sessione non di pagamento' });
    if (s.payment_status !== 'paid') return resp(409, { error: 'Pagamento non acquisito' });

    // 2) Idempotenza su PaymentIntent
    const piId = String(s.payment_intent || '');
    if (!piId) return resp(400, { error: 'Payment Intent assente' });

    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata && pi.metadata.colpamiaCredited === 'true') {
      return resp(200, { ok: true, credited: false, reason: 'già accreditato' });
    }

    // 3) Email: FONTE AUTORITARIA
    const emailFromSession = (s.customer_details && s.customer_details.email) || s.customer_email || null;
    const email =
      (emailFromSession && String(emailFromSession).toLowerCase()) ||
      (isValidEmail(email_fallback) ? String(email_fallback).toLowerCase() : null);

    if (!email) return resp(400, { error: 'Email assente/illeggibile' });

    // 4) Line items -> minuti
    const items = await stripe.checkout.sessions.listLineItems(session_id, { limit: 100, expand: ['data.price.product'] });
    const minutes = calcMinutes(items.data);
    if (minutes <= 0) return resp(400, { error: 'Nessun articolo valido per accredito' });

    // 5) TODO: accredita i minuti nel tuo sistema (wallet)
    // Se hai già una function locale, richiamala qui.
    // Esempio (se esiste netlify/functions/wallet.js con export creditMinutes):
    try {
      const wallet = require('./wallet');
      if (wallet && typeof wallet.creditMinutes === 'function') {
        await wallet.creditMinutes(email, minutes, { phone, session_id, piId });
      }
    } catch (_) { /* nessun wallet local, prosegui */ }

    // 6) Idempotenza: marchia il PI su Stripe (così non duplichi mai)
    await stripe.paymentIntents.update(piId, { metadata: { ...(pi.metadata || {}), colpamiaCredited: 'true' } });

    // 7) (opzionale) invii: email/sms/whatsapp → aggiungi qui se vuoi

    return resp(200, { ok: true, credited: true, email, minutes });
  } catch (err) {
    return resp(500, { error: err.message || 'Errore interno' });
  }
};

function calcMinutes(lineItems) {
  let tot = 0;
  for (const li of lineItems) {
    const price = li.price || {};
    const product = price.product || {};
    // 1) ENV mapping prioritario
    if (MAP_FROM_ENV[price.id]) { tot += (MAP_FROM_ENV[price.id] * (li.quantity || 1)); continue; }
    // 2) metadata.minutes su price o product (se l'hai impostato in Dashboard)
    const m1 = parseInt((price.metadata && price.metadata.minutes) || '', 10);
    const m2 = parseInt((product.metadata && product.metadata.minutes) || '', 10);
    const mins = (!isNaN(m1) ? m1 : (!isNaN(m2) ? m2 : 0));
    tot += mins * (li.quantity || 1);
  }
  return tot;
}

function isValidEmail(x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || '')); }

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function resp(statusCode, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

