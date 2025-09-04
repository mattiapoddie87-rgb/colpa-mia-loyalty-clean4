// netlify/functions/create-checkout-session.js
// Crea una Stripe Checkout Session partendo da SKU / PriceId / Responsabile.
// Supporta: price diretto, mappa RESPONSABILE_*, mappa SKU esplicita, fallback su metadata.sku.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, body) => ({
  statusCode: status,
  headers: { ...cors, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Mappa commerciale → Price ID (LIVE). Sostituisci coi tuoi price_. */
const PRICE_MAP = {
  RESPONSABILE_AZIENDA:    'price_1S3f7eAuMAjkbPdHwbD8XqtV',
  RESPONSABILE_INFLUENCER: 'price_1S3fhAAuMAjkbPdHVRWBXJt5',
  RESPONSABILE_CRISI:      'price_1S3fjaAuMAjkbPdHzSuZksed',
};

/** Mappa SKU → Price ID (LIVE). COMPILA per blindare i prezzi. */
const PRICE_BY_SKU = {
  SCUSA_ENTRY:  'price_1S3O3BAuMAjkbPdH40irfbqa', // 0,50 € (esempio tuo)
  // SCUSA_BASE:   'price_XXXXXXXX',
  // SCUSA_TRIPLA: 'price_YYYYYYYY',
  // SCUSA_DELUXE: 'price_ZZZZZZZZ',
  // RIUNIONE:     'price_AAAAAAAA',
  // TRAFFICO:     'price_BBBBBBBB',
  // CONN_KO:      'price_CCCCCCCC',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

    // ---- Input
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
      return json(405, { error: 'METHOD_NOT_ALLOWED' });
    }

    const email        = String(body.email || '').trim().toLowerCase();
    const priceIdIn    = String(body.priceId || '').trim();
    const skuIn        = String(body.sku || '').trim().toUpperCase();
    const responsabile = String(body.responsabile || '').trim().toUpperCase();
    const qty          = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    // ---- Risoluzione Price
    let price = null;

    async function loadPrice(id) {
      const p = await stripe.prices.retrieve(id);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      return p;
    }

    // 1) priceId diretto
    if (!price && priceIdIn) price = await loadPrice(priceIdIn);

    // 2) Responsabile → PRICE_MAP
    if (!price && responsabile) {
      const id = PRICE_MAP[responsabile];
      if (!id) return json(400, { error: 'RESPONSABILE_NOT_MAPPED', detail: { responsabile } });
      price = await loadPrice(id);
    }

    // 3) SKU → PRICE_BY_SKU
    if (!price && skuIn) {
      const mapped = PRICE_BY_SKU[skuIn];
      if (mapped) price = await loadPrice(mapped);
    }

    // 4) Fallback: cerca per metadata.sku (price o product)
    if (!price && skuIn) {
      const list = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = list.data.find(p =>
        (p.metadata?.sku && String(p.metadata.sku).toUpperCase() === skuIn) ||
        (p.product?.metadata?.sku && String(p.product.metadata.sku).toUpperCase() === skuIn)
      ) || null;
    }

    if (!price) return json(400, { error: 'PRICE_NOT_FOUND', detail: { sku: skuIn || null, responsabile: responsabile || null } });

    // ---- Determina mode (payment vs subscription)
    const mode = price.recurring ? 'subscription' : 'payment';

    // ---- Riuso customer per email
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

    // ---- URLs del sito
    const site =
      process.env.SITE_URL ||
      (event.headers?.origin && /^https?:\/\//.test(event.headers.origin) ? event.headers.origin : 'https://colpamia.com');

    // ---- Crea Session
    const params = {
      mode,
      line_items: [{ price: price.id, quantity: qty }],
      success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${site}/cancel`,
      custom_fields: [{
        key: 'need',
        label: { type: 'custom', custom: 'Esigenza (facoltativa)' },
        type: 'text',
        optional: true,
      }],
      // phone_number_collection: { enabled: true }, // abilita se vuoi raccogliere il telefono
      // allow_promotion_codes: true,
      metadata: { origin: 'colpamia', sku: skuIn || '', responsabile },
    };

    if (customer) params.customer = customer.id;
    else if (email) { params.customer_email = email; params.customer_creation = 'if_required'; }

    const session = await stripe.checkout.sessions.create(params);
    return json(200, { url: session.url, id: session.id, mode });

  } catch (e) {
    console.error('create-checkout-session error:', e?.message || e);
    return json(500, { error: e?.message || 'INTERNAL_ERROR' });
  }
};
