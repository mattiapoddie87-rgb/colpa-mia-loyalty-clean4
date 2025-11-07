// netlify/functions/fulfillment.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { creditMinutes, creditFromDuration } = require('./_wallet-lib');

const PRICE_BY_SKU = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
const PRICE_RULES = JSON.parse(process.env.PRICE_RULES_JSON || '{}');

// helper per mappare SKU <-> minuti
function getMinutesForSKU(sku) {
  const rule = PRICE_RULES[sku];
  if (!rule) return 0;
  return rule.minutes || 0;
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { sessionId } = body;

    if (!sessionId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'sessionId mancante' }) };
    }

    // recupera sessione stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer'],
    });

    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'email mancante nella sessione' }) };
    }

    // SKU del prodotto acquistato
    const lineItem = session.line_items?.data?.[0];
    const priceId = lineItem?.price?.id;
    const sku = Object.keys(PRICE_BY_SKU).find(k => PRICE_BY_SKU[k] === priceId);

    const txKey = `stripe:${session.id}`;
    const startTime = session.metadata?.start_time;
    const endTime = session.metadata?.end_time;

    // Se è una scusa base/deluxe/traffico ecc. accredito fisso
    if (sku && getMinutesForSKU(sku) > 0) {
      const minutes = getMinutesForSKU(sku);
      await creditMinutes(
        email,
        minutes,
        `Accredito minuti per ${sku}`,
        { sku, priceId, sessionId },
        txKey
      );
      console.log(`✅ Accreditati ${minutes} minuti per ${sku} (${email})`);
    }

    // Se è una mediazione o consulenza con durata effettiva
    if (startTime && endTime) {
      await creditFromDuration(
        email,
        startTime,
        endTime,
        'Accredito tempo effettivo mediazione',
        { sku, sessionId },
        txKey
      );
      console.log(`🕒 Accreditato tempo dinamico per ${email}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };

  } catch (error) {
    console.error('Errore fulfillment:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
