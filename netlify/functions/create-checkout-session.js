// netlify/functions/create-checkout-session.js
// Crea una Stripe Checkout Session.
// - Riusa il Customer esistente (niente duplicati).
// - Precompila l'email se la passi.
// - Aggiunge un campo "Esigenza" (custom_fields.need) che il fulfillment userà per generare la scusa.
// - Accetta POST (JSON) o GET (query) con: { email?, priceId? | sku?, qty? }

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

    // ---- input
    let body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else if (event.httpMethod === 'GET') {
      const q = new URLSearchParams(event.queryStringParameters || {});
      body = { email: q.get('email'), priceId: q.get('priceId'), sku: q.get('sku'), qty: q.get('qty') };
    } else {
      return resp(405, { error: 'Method Not Allowed' });
    }

    const email = String(body.email || '').trim().toLowerCase();
    const priceIdIn = String(body.priceId || '').trim();
    const skuIn     = String(body.sku || '').trim();
    const quantity  = Math.max(1, parseInt(body.qty || '1', 10));

    // ---- risolvi il price
    let price = null;

    if (priceIdIn) {
      price = await stripe.prices.retrieve(priceIdIn);
      if (!price.active) throw new Error('Price non attivo');
    }

    if (!price && skuIn) {
      const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = prices.data.find(p =>
        (p.metadata && p.metadata.sku === skuIn) ||
        (p.product && p.product.metadata && p.product.metadata.sku === skuIn)
      ) || null;
    }

    if (!price) return resp(400, { error: 'Price non trovato (passa priceId o sku valido)' });

    // ---- riusa Customer se esiste
    let existingCustomer = null;
    if (email) {
      try {
        const r = await stripe.customers.search({ query: `email:"${email}"`, limit: 1 });
        existingCustomer = r.data[0] || null;
      } catch {
        const r2 = await stripe.customers.list({ email, limit: 1 });
        existingCustomer = r2.data[0] || null;
      }
    }

    // ---- crea sessione
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity }],
      success_url: 'https://colpamia.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://colpamia.com/cancel',
      ...(existingCustomer
        ? { customer: existingCustomer.id }
        : { customer_email: email || undefined, customer_creation: 'always' }
      ),
      // Campo testo libero per l'esigenza (letto dal webhook/claim)
      custom_fields: [{
        key: 'need',
        label: { type: 'custom', custom: 'Esigenza (facoltativa)' },
        type: 'text',
        optional: true
      }],
      // opzionale ma utile: chiedi numero telefono in checkout
      phone_number_collection: { enabled: true },
      // opzionale: promocode
      allow_promotion_codes: true
    });

    return resp(200, { url: session.url, id: session.id });
  } catch (err) {
    return resp(500, { error: err.message || 'Errore interno' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
