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
  console.log('fulfillment called with', event.httpMethod, event.body);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'method_not_allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const sessionId = body.sessionId;
    if (!sessionId) {
      console.log('sessionId missing');
      return { statusCode: 400, body: 'sessionId missing' };
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer'],
    });

    console.log('stripe session', session.id);

    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      console.log('email missing on session');
      return { statusCode: 400, body: 'email missing' };
    }

    const lineItem = session.line_items?.data?.[0];
    const priceId = lineItem?.price?.id;
    console.log('priceId', priceId);

    const sku = Object.keys(PRICE_BY_SKU).find(
      (key) => PRICE_BY_SKU[key] === priceId
    );
    console.log('mapped sku', sku);

    const txKey = `stripe:${session.id}`;
    const startTime = session.metadata?.start_time;
    const endTime = session.metadata?.end_time;

    if (sku) {
      const minutes = getMinutesForSKU(sku);
      console.log('minutes for sku', sku, minutes);
      if (minutes > 0) {
        await creditMinutes(
          email,
          minutes,
          `Accredito minuti per ${sku}`,
          { sku, priceId, sessionId },
          txKey
        );
        console.log('✅ credited', minutes, 'to', email);
      } else {
        console.log('no minutes configured for', sku);
      }
    } else {
      console.log('no sku found for priceId', priceId);
    }

    if (startTime && endTime) {
      await creditFromDuration(
        email,
        startTime,
        endTime,
        'Accredito tempo mediazione',
        { sku, sessionId },
        txKey
      );
      console.log('🕒 credited from duration');
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
