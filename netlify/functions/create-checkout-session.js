// netlify/functions/create-checkout-session.js
// Crea una Stripe Checkout Session precompilando l'email e creando sempre un Customer.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors };
    }

    // Accetto POST (preferito) o GET con query param
    let body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      body.sku = params.get('sku');
      body.priceId = params.get('priceId');
      body.email = params.get('email');
      body.qty = params.get('qty');
    } else {
      return resp(405, { error: 'Method Not Allowed' });
    }

    const sku = (body.sku || '').trim();             // tuo SKU di comodo (opzionale)
    const priceId = (body.priceId || '').trim();     // se passi direttamente un price_...
    const email = (body.email || '').trim().toLowerCase();
    const quantity = Math.max(1, parseInt(body.qty || '1', 10));

    // Trova il Price da usare
    let price = null;

    // 1) Se ho priceId lo uso
    if (priceId) {
      price = await stripe.prices.retrieve(priceId);
      if (!price.active) throw new Error('Price non attivo');
    }

    // 2) Altrimenti cerco per SKU (in metadata.price.sku o product.metadata.sku)
    if (!price && sku) {
      // Prova su prices
      const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = prices.data.find(p =>
        (p.metadata && p.metadata.sku === sku) ||
        (p.product && p.product.metadata && p.product.metadata.sku === sku)
      ) || null;
    }

    if (!price) {
      return resp(400, { error: 'Price non trovato (priceId o sku assenti/non validi)' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity }],
      success_url: 'https://colpamia.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://colpamia.com/cancel',
      customer_email: email || undefined,        // precompila
      customer_creation: 'always',               // crea/aggancia Customer
      // (opzionale) metadata: { sku }
    });

    return resp(200, { url: session.url, id: session.id });
  } catch (err) {
    return resp(500, { error: err.message || 'Errore interno' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}


