// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Opzionale: per maggiore sicurezza puoi whitelistarle in env:
 * ALLOWED_PRICE_IDS=price_123,price_abc,price_xyz
 */
function isAllowedPrice(priceId) {
  const allow = (process.env.ALLOWED_PRICE_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return allow.length ? allow.includes(priceId) : true; // se non definito, accetta tutto
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { priceId } = JSON.parse(event.body || '{}');
    if (!priceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing priceId' }) };
    }

    if (!isAllowedPrice(priceId)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Price not allowed' }) };
    }

    const siteURL = process.env.SITE_URL || 'http://localhost:8888';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteURL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteURL}/cancel.html`,
      // volendo: customer_email, metadata, ecc.
    });

    // Netlify gestisce bene i 303 con Location per redirect immediato
    return {
      statusCode: 303,
      headers: { Location: session.url }
    };
  } catch (err) {
    console.error('[create-checkout-session] Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

