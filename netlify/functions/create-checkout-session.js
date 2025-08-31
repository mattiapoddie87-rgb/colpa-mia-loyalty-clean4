// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resp(status, body) {
  return { statusCode: status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

    // --- input ---
    let body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else if (event.httpMethod === 'GET') {
      const q = new URLSearchParams(event.queryStringParameters || {});
      body = {
        email:   q.get('email'),
        priceId: q.get('priceId') || q.get('price'),
        sku:     q.get('sku'),
        qty:     q.get('qty')
      };
    } else {
      return resp(405, { error: 'METHOD_NOT_ALLOWED' });
    }

    const email   = String(body.email || '').trim().toLowerCase();
    const priceId = String(body.priceId || '').trim();
    const sku     = String(body.sku || '').trim();
    const qty     = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    // --- resolve price ---
    let price = null;
    if (priceId) {
      price = await stripe.prices.retrieve(priceId);
      if (!price?.active) throw new Error('PRICE_NOT_ACTIVE');
    }
    if (!price && sku) {
      const list = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = list.data.find(p =>
        (p.metadata?.sku === sku) ||
        (p.product && p.product.metadata?.sku === sku)
      ) || null;
    }
    if (!price) return resp(400, { error: 'PRICE_NOT_FOUND' });

    // --- reuse customer if exists ---
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

    // --- URLs ---
    const site =
      process.env.SITE_URL ||
      (event.headers && event.headers.origin && /^https?:\/\//.test(event.headers.origin) ? event.headers.origin : 'https://colpamia.com');

    // --- session params (puliti, zero fronzoli che rompono) ---
    const params = {
      mode: 'payment',
      line_items: [{ price: price.id, quantity: qty }],
      success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${site}/cancel`,
      custom_fields: [{
        key: 'need',
        label: { type: 'custom', custom: 'Esigenza (facoltativa)' },
        type: 'text',
        optional: true
      }],
    };

    if (existingCustomer) {
      params.customer = existingCustomer.id;
    } else if (email) {
      params.customer_email = email;
      params.customer_creation = 'if_required'; // non esplode se manca email/altre condizioni
    }
    // se vuoi promo: params.allow_promotion_codes = true;

    const session = await stripe.checkout.sessions.create(params);
    return resp(200, { url: session.url, id: session.id });
  } catch (e) {
    return resp(500, { error: e.message || 'INTERNAL_ERROR' });
  }
};
