// netlify/functions/create-checkout-session.js
// Crea una Stripe Checkout Session.
// Supporta: priceId diretto, sku (lookup tra prezzi attivi), e una mappa PRICE_MAP per "responsabile".

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Mappa "commerciale" → Stripe Price ID
 * Sostituisci i placeholder con i tuoi price_... reali.
 */
const PRICE_MAP = {
  RESPONSABILE_AZIENDA:    'price_1S3f7eAuMAjkbPdHwbD8XqtV',
  RESPONSABILE_INFLUENCER: 'price_1S3fhAAuMAjkbPdHVRWBXJt5',
  RESPONSABILE_CRISI:      'price_1S3fjaAuMAjkbPdHzSuZksed',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors };
    }

    // ---- input
    let body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else if (event.httpMethod === 'GET') {
      const q = new URLSearchParams(event.queryStringParameters || {});
      body = {
        email:        q.get('email'),
        priceId:      q.get('priceId') || q.get('price'),
        sku:          q.get('sku'),
        qty:          q.get('qty'),
        responsabile: q.get('responsabile'),
      };
    } else {
      return resp(405, { error: 'METHOD_NOT_ALLOWED' });
    }

    const email        = String(body.email || '').trim().toLowerCase();
    const priceIdIn    = String(body.priceId || '').trim();
    const skuIn        = String(body.sku || '').trim();
    const responsabile = String(body.responsabile || '').trim();  // NEW
    const qty          = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    // ---- risolvi il Price
    let price = null;

    // 1) Se passano già il priceId, lo usiamo
    if (!price && priceIdIn) {
      const p = await stripe.prices.retrieve(priceIdIn);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      price = p;
    }

    // 2) Se passano "responsabile" e c'è in mappa → risolviamo a priceId
    if (!price && responsabile) {
      const key = responsabile.toUpperCase(); // es. RESPONSABILE_AZIENDA
      const mappedPriceId = PRICE_MAP[key];
      if (!mappedPriceId) {
        return resp(400, { error: 'RESPONSABILE_NOT_MAPPED', detail: { responsabile: key } });
      }
      const p = await stripe.prices.retrieve(mappedPriceId);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      price = p;
    }

    // 3) Fallback: se passano uno "sku", cerchiamo tra i prezzi attivi
    if (!price && skuIn) {
      const list = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = list.data.find(p =>
        (p.metadata?.sku === skuIn) ||
        (p.product && p.product.metadata?.sku === skuIn)
      ) || null;
    }

    if (!price) return resp(400, { error: 'PRICE_NOT_FOUND' });

    // ---- riuso cliente se esiste
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

    // ---- URLs base
    const site =
      process.env.SITE_URL ||
      (event.headers && event.headers.origin && /^https?:\/\//.test(event.headers.origin)
        ? event.headers.origin
        : 'https://colpamia.com');

    // ---- parametri sessione (puliti)
    const params = {
      mode: 'payment',
      line_items: [{ price: price.id, quantity: qty }],
      success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${site}/cancel`,
      custom_fields: [{
        key: 'need',
        label: { type: 'custom', custom: 'Esigenza (facoltativa)' },
        type: 'text',
        optional: true,
      }],
    };

    if (existingCustomer) {
      params.customer = existingCustomer.id;
    } else if (email) {
      params.customer_email = email;
      params.customer_creation = 'if_required';
    }

    // se vuoi i codici promo:
    // params.allow_promotion_codes = true;

    const session = await stripe.checkout.sessions.create(params);
    return resp(200, { url: session.url, id: session.id });

  } catch (e) {
    return resp(500, { error: e.message || 'INTERNAL_ERROR' });
  }
};
