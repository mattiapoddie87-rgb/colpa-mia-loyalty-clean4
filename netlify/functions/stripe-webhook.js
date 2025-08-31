// netlify/functions/stripe-webhook.js
// Webhook Stripe: accredita minuti e genera eventuali "scuse" su checkout.session.completed.
// Idempotenza su PaymentIntent.metadata.colpamiaCredited = 'true'

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// utils
const safeJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
function safeRequire(path) { try { return require(path); } catch { return null; } }
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
    // body RAW (necessario per la verifica firma)
    const sig = event.headers['stripe-signature'];
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    if (stripeEvent.type === 'checkout.session.completed') {
      const s = stripeEvent.data.object; // Checkout.Session
      const piId = String(s.payment_intent || '');
      if (!piId) return ok();

      const pi = await stripe.paymentIntents.retrieve(piId);
      if (!(pi.metadata && pi.metadata.colpamiaCredited === 'true')) {
        // Line items
        const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 100, expand: ['data.price.product'] });

        // Calcolo minuti + scuse
        let minutes = 0;
        let excuses = [];
        const fulfillment = safeRequire('./fulfillment');
        if (fulfillment && typeof fulfillment.processLineItems === 'function') {
          const firstName = (s.customer_details?.name || '').split(' ')[0] || 'Ciao';
          const out = await fulfillment.processLineItems(items.data, { first_name: firstName });
          minutes = Number(out.minutes || 0);
          excuses = Array.isArray(out.excuses) ? out.excuses : [];
        } else {
          minutes = fallbackCalcMinutes(items.data);
          excuses = [];
        }

        // Accredito minuti se presenti
        if (minutes > 0) {
          try {
            const wallet = safeRequire('./wallet');
            if (wallet && typeof wallet.creditMinutes === 'function') {
              const email = String((s.customer_details?.email || s.customer_email || '')).toLowerCase();
              await wallet.creditMinutes(email, minutes, { session_id: s.id, piId });
            }
          } catch (_) { /* ignora errori wallet */ }
        }

        // (facoltativo) consegna scuse via email/whatsapp qui

        // Idempotenza
        await stripe.paymentIntents.update(piId, {
          metadata: {
            ...(pi.metadata || {}),
            colpamiaCredited: 'true',
            minutesCredited: String(minutes || 0),
            excusesCount: String(excuses.length || 0),
          },
        });
      }
    }

    return ok();
  } catch (err) {
    return { statusCode: 500, body: err.message || 'Errore interno' };
  }
};

function ok() { return { statusCode: 200, body: JSON.stringify({ received: true }) }; }
