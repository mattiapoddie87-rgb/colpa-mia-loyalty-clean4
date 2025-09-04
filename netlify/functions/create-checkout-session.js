// netlify/functions/create-checkout-session.js
// Crea una Stripe Checkout Session partendo da SKU/PriceId/Responsabile.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PRICE_MAP = {
  RESPONSABILE_AZIENDA:    'price_1S3f7eAuMAjkbPdHwbD8XqtV',
  RESPONSABILE_INFLUENCER: 'price_1S3fhAAuMAjkbPdHVRWBXJt5',
  RESPONSABILE_CRISI:      'price_1S3fjaAuMAjkbPdHzSuZksed',
};

// ⬇️ Mappa esplicita SKU → Price ID (metti qui il price della “Prima Scusa -50%”)
const PRICE_BY_SKU = {
  // Esempio (0,50 €): SOSTITUISCI con il tuo price_ reale
  SCUSA_ENTRY: 'price_xxxxxxxxxxxxxxxxxxxxx',
  // opzionale: mappa anche gli altri se vuoi evitare la ricerca per metadata
  // SCUSA_BASE:   'price_1S1vuQAuMAjkbPdHnq3JIDQZ',
  // SCUSA_TRIPLA: 'price_1S1vuUAuMAjkbPdHNPjekZHq',
  // SCUSA_DELUXE: 'price_1S1vuXAuMAjkbPdHmgyfY8Bj',
  // RIUNIONE:     'price_1S1wdXAuMAjkbPdHfqU3fnwq',
  // TRAFFICO:     'price_1S1wdaAuMAjkbPdH8We1FVEy',
  // CONN_KO:      'price_1S1w4RAuMAjkbPdHLfPElLnX',
};

function json(status, body) {
  return { statusCode: status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

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
      return json(405, { error: 'METHOD_NOT_ALLOWED' });
    }

    const email        = String(body.email || '').trim().toLowerCase();
    const priceIdIn    = String(body.priceId || '').trim();
    const skuInRaw     = String(body.sku || '').trim();
    const skuIn        = skuInRaw ? skuInRaw.toUpperCase() : '';
    const responsabile = String(body.responsabile || '').trim().toUpperCase();
    const qty          = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    // ---- risoluzione prezzo
    let price = null;

    // 1) Price ID passato direttamente
    if (!price && priceIdIn) {
      const p = await stripe.prices.retrieve(priceIdIn);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      price = p;
    }

    // 2) Responsabile (mappa commerciale → price)
    if (!price && responsabile) {
      const id = PRICE_MAP[responsabile];
      if (!id) return json(400, { error: 'RESPONSABILE_NOT_MAPPED', detail: { responsabile } });
      const p = await stripe.prices.retrieve(id);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      price = p;
    }

    // 3) SKU mappata esplicitamente → price
    if (!price && skuIn) {
      const mapped = PRICE_BY_SKU[skuIn];
      if (mapped) {
        const p = await stripe.prices.retrieve(mapped);
        if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
        price = p;
      }
    }

    // 4) Fallback: cerca per metadata.sku (price o product)
    if (!price && skuIn) {
      const list = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = list.data.find(p =>
        (p.metadata?.sku && String(p.metadata.sku).toUpperCase() === skuIn) ||
        (p.product && p.product.metadata?.sku && String(p.product.metadata.sku).toUpperCase() === skuIn)
      ) || null;
    }

    if (!price) return json(400, { error: 'PRICE_NOT_FOUND', detail: { sku: skuIn } });

    // ---- riuso cliente se esiste
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

    // ---- URLs
    const site =
      process.env.SITE_URL ||
      (event.headers && event.headers.origin && /^https?:\/\//.test(event.headers.origin) ? event.headers.origin : 'https://colpamia.com');

    // ---- crea sessione
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
    if (customer) params.customer = customer.id; else if (email) { params.customer_email = email; params.customer_creation = 'if_required'; }

    const session = await stripe.checkout.sessions.create(params);
    return json(200, { url: session.url, id: session.id });

  } catch (e) {
    return json(500, { error: e.message || 'INTERNAL_ERROR' });
  }
};
