// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PRICE_BY_SKU = {
  // Mappa solo ciò che sei sicuro sia corretto (live!).
  SCUSA_ENTRY: 'price_1S3O3BAuMAjkbPdH40irfbqa',
  // Se vuoi, aggiungi gli altri SOLO quando verifichi l’ID live in Stripe.
};

const j = (s, b) => ({ statusCode: s, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

    let body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch {}
    } else if (event.httpMethod === 'GET') {
      const q = new URLSearchParams(event.queryStringParameters || {});
      body = { sku: q.get('sku'), email: q.get('email'), qty: q.get('qty') };
    } else {
      return j(405, { error: 'METHOD_NOT_ALLOWED' });
    }

    const sku   = String(body.sku || '').trim().toUpperCase();
    const email = String(body.email || '').trim().toLowerCase();
    const qty   = Math.max(1, parseInt(body.qty || '1', 10) || 1);
    if (!sku) return j(400, { error: 'SKU_REQUIRED' });

    let priceId = PRICE_BY_SKU[sku];
    let price   = null;

    // 1) Prova mapping, MA se fallisce passa al fallback
    if (priceId) {
      try {
        price = await stripe.prices.retrieve(priceId);
        if (!price?.active) throw new Error('PRICE_NOT_ACTIVE');
      } catch (e) {
        priceId = null; // forza fallback su metadata.sku
      }
    }

    // 2) Fallback: cerca per metadata.sku (price o product)
    if (!priceId) {
      const list = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = list.data.find(p =>
        (p.metadata?.sku && String(p.metadata.sku).toUpperCase() === sku) ||
        (p.product?.metadata?.sku && String(p.product.metadata.sku).toUpperCase() === sku)
      ) || null;
      if (!price) return j(400, { error: 'PRICE_NOT_FOUND', detail: { sku, hint: 'imposta metadata.sku in Stripe o compila PRICE_BY_SKU' } });
      priceId = price.id;
    }

    // customer reuse (facoltativo)
    let customer = null;
    if (email) {
      try {
        const r = await stripe.customers.search({ query: `email:"${email}"`, limit: 1 });
        customer = r.data[0] || null;
      } catch {
        const r2 = await stripe.customers.list({ email, limit: 1 });
        customer = r2.data[0] || null;
      }
    }

    const site = process.env.SITE_URL ||
      (/^https?:\/\//.test(event.headers?.origin || '') ? event.headers.origin : 'https://colpamia.com');

    const params = {
      mode: 'payment',
      line_items: [{ price: priceId, quantity: qty }],
      success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${site}/cancel`,
      custom_fields: [{
        key: 'need',
        label: { type: 'custom', custom: 'Esigenza (facoltativa)' },
        type: 'text',
        optional: true,
      }],
    };
    if (customer) params.customer = customer.id;
    else if (email) { params.customer_email = email; params.customer_creation = 'if_required'; }

    const session = await stripe.checkout.sessions.create(params);
    return j(200, { url: session.url, id: session.id });
  } catch (e) {
    return j(500, { error: e?.message || 'INTERNAL_ERROR' });
  }
};
