// netlify/functions/fulfillment.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { creditMinutes, creditFromDuration } = require('./_wallet-lib');

const PRICE_BY_SKU = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
const PRICE_RULES  = JSON.parse(process.env.PRICE_RULES_JSON  || '{}');

function getMinutesForSKU(sku, metadata = {}) {
  const rule = PRICE_RULES[sku];
  if (rule && rule.minutes) return rule.minutes;
  // fallback: se Stripe ha passato metadata.minutes, usalo
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

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer'],
    });

    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      return { statusCode: 400, body: 'email missing' };
    }

    const lineItem = session.line_items?.data?.[0];
    const priceId  = lineItem?.price?.id;
    const metadata = session.metadata || {};

    // mappa priceId -> sku
    const sku = Object.keys(PRICE_BY_SKU).find(
      key => PRICE_BY_SKU[key] === priceId
    );

    const txKey = `stripe:${session.id}`;

    // accredito “a forfait” da regole o metadata
    if (sku) {
      const minutes = getMinutesForSKU(sku, metadata);
      if (minutes > 0) {
        await creditMinutes(
          email,
          minutes,
          `Accredito minuti per ${sku}`,
          { sku, priceId, sessionId },
          txKey
        );
      }
    }

    // accredito “a durata” se ci sono start/end
    const startTime = metadata.start_time;
    const endTime   = metadata.end_time;
    if (startTime && endTime) {
      await creditFromDuration(
        email,
        startTime,
        endTime,
        'Accredito tempo mediazione',
        { sku, sessionId },
        txKey
      );
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message };
  }
};
