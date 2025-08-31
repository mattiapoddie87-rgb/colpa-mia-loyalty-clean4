// netlify/functions/stripe-webhook.js
// Webhook Stripe: gestisce checkout.session.completed e accredita minuti automaticamente.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Riusa la stessa mappatura ENV del claim manuale
const MAP_FROM_ENV = safeJson(process.env.PRICE_MINUTES_JSON) || {};

exports.handler = async (event) => {
  try {
    const sig = event.headers['stripe-signature'];
    // Netlify può inviare body base64
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    if (stripeEvent.type === 'checkout.session.completed') {
      const s = stripeEvent.data.object; // Checkout.Session
      // Idempotenza su PI
      const piId = String(s.payment_intent || '');
      if (!piId) return ok();

      const pi = await stripe.paymentIntents.retrieve(piId);
      if (!(pi.metadata && pi.metadata.colpamiaCredited === 'true')) {
        // Calcola minuti
        const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 100, expand: ['data.price.product'] });
        const minutes = calcMinutes(items.data);
        if (minutes > 0) {
          // Accredita (se hai wallet local)
          try {
            const wallet = require('./wallet');
            if (wallet && typeof wallet.creditMinutes === 'function') {
              const email = (s.customer_details && s.customer_details.email) || s.customer_email;
              await wallet.creditMinutes(String(email || '').toLowerCase(), minutes, { session_id: s.id, piId });
            }
          } catch (_) { /* ignora se non presente */ }

          // Marchia idempotenza
          await stripe.paymentIntents.update(piId, { metadata: { ...(pi.metadata || {}), colpamiaCredited: 'true' } });
        }
      }
    }

    // (opzionale) gestisci anche payment_intent.succeeded come fallback

    return ok();
  } catch (err) {
    return { statusCode: 500, body: err.message || 'Errore interno' };
  }
};

function calcMinutes(lineItems) {
  let tot = 0;
  for (const li of lineItems) {
    const price = li.price || {};
    const product = price.product || {};
    if (MAP_FROM_ENV[price.id]) { tot += (MAP_FROM_ENV[price.id] * (li.quantity || 1)); continue; }
    const m1 = parseInt((price.metadata && price.metadata.minutes) || '', 10);
    const m2 = parseInt((product.metadata && product.metadata.minutes) || '', 10);
    const mins = (!isNaN(m1) ? m1 : (!isNaN(m2) ? m2 : 0));
    tot += mins * (li.quantity || 1);
  }
  return tot;
}
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function ok() { return { statusCode: 200, body: JSON.stringify({ received: true }) }; }
