// netlify/functions/fulfillment.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { creditMinutes, creditFromDuration } = require('./_wallet-lib');

const PRICE_BY_SKU = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
const PRICE_RULES = JSON.parse(process.env.PRICE_RULES_JSON || '{}');

function getMinutesForSKU(sku) {
  const rule = PRICE_RULES[sku];
  if (!rule) return 0;
  return rule.minutes || 0;
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

    // 1) prendo la sessione stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer'],
    });

    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      return { statusCode: 400, body: 'email missing' };
    }

    const lineItem = session.line_items?.data?.[0];
    const priceId = lineItem?.price?.id;

    // 2) mappo priceId -> SKU usando PRICE_BY_SKU_JSON
    const sku = Object.keys(PRICE_BY_SKU).find(
      (key) => PRICE_BY_SKU[key] === priceId
    );

    const txKey = `stripe:${session.id}`;
    const startTime = session.metadata?.start_time;
    const endTime = session.metadata?.end_time;

    // 3a) caso scusa: minuti fissi dal JSON
    if (sku) {
      const minutes = getMinutesForSKU(sku);
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

    // 3b) caso mediazione: durata effettiva
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

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: err.message,
    };
  }
};
