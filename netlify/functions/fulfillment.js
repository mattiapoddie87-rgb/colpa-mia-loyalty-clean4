// netlify/functions/fulfillment.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { creditMinutes, creditFromDuration } = require('./_wallet-lib');

const PRICE_BY_SKU = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
const PRICE_RULES  = JSON.parse(process.env.PRICE_RULES_JSON  || '{}');

function minutesFor(sku, metadata = {}) {
  // 1) prova dalle regole
  if (PRICE_RULES[sku] && PRICE_RULES[sku].minutes) {
    return PRICE_RULES[sku].minutes;
  }
  // 2) fallback: se Stripe aveva messo metadata.minutes
  if (metadata.minutes) {
    const m = parseInt(metadata.minutes, 10);
    if (!isNaN(m) && m > 0) return m;
  }
  return 0;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'method_not_allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const sessionId = body.sessionId;
    if (!sessionId) {
      return { statusCode: 400, body: 'sessionId missing' };
    }

    // prendo la sessione da Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer'],
    });

    const email =
      session.customer_details?.email ||
      session.customer_email;
    if (!email) {
      return { statusCode: 400, body: 'email missing' };
    }

    const md = session.metadata || {};

    // 1) primo tentativo: SKU dai metadata (questo tu lo hai SEMPRE)
    let sku = md.sku;

    // 2) se proprio non c'è, provo a ricavarlo dal priceId
    if (!sku) {
      const lineItem = session.line_items?.data?.[0];
      const priceId  = lineItem?.price?.id;
      if (priceId) {
        sku = Object.keys(PRICE_BY_SKU).find(
          key => PRICE_BY_SKU[key] === priceId
        );
      }
    }

    const txKey = `stripe:${session.id}`;

    // accredito minuti a forfait
    if (sku) {
      const mins = minutesFor(sku, md);
      if (mins > 0) {
        await creditMinutes(
          email,
          mins,
          `Accredito minuti per ${sku}`,
          { sku, sessionId },
          txKey
        );
      }
    }

    // accredito da durata se presente
    if (md.start_time && md.end_time) {
      await creditFromDuration(
        email,
        md.start_time,
        md.end_time,
        'Accredito tempo mediazione',
        { sku, sessionId },
        txKey
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('fulfillment error', err);
    return {
      statusCode: 500,
      body: err.message,
    };
  }
};
