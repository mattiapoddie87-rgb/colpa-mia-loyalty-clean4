// netlify/functions/create-checkout-session.js
// Crea una Stripe Checkout Session (payment o subscription in base al price).
// Supporta: priceId diretto, sku (lookup), mappa RESPONSABILE_*.

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

// Mappa commerciale → Price ID (assicurati che siano nello stesso ambiente della chiave!).
const PRICE_MAP = {
  RESPONSABILE_AZIENDA:    'price_1S3f7eAuMAjkbPdHwbD8XqtV',
  RESPONSABILE_INFLUENCER: 'price_1S3fhAAuMAjkbPdHVRWBXJt5',
  RESPONSABILE_CRISI:      'price_1S3fjaAuMAjkbPdHzSuZksed',
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
    const responsabile = String(body.responsabile || '').trim();
    const qty          = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    // ---- risolvi il Price
    let price = null;

    async function getPriceById(id) {
      try {
        const p = await stripe.prices.retrieve(id);
        if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
        return p;
      } catch (err) {
        // errore tipico: price non esiste nell’ambiente corrente (test vs live)
        throw new Error(`PRICE_RETRIEVE_FAILED: ${err?.message || 'unknown'}`);
      }
    }

    // 1) priceId diretto
    if (!price && priceIdIn) {
      price = await getPriceById(priceIdIn);
    }

    // 2) mappa RESPONSABILE_*
    if (!price && responsabile) {
      const key = responsabile.toUpperCase();
      const mappedId = PRICE_MAP[key];
      if (!mappedId) return resp(400, { error: 'RESPONSABILE_NOT_MAPPED', detail: { responsabile: key } });
      price = await getPriceById(mappedId);
    }

    // 3) lookup per sku su prezzi attivi
    if (!price && skuIn) {
      const list = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = list.data.find(p =>
        (p.metadata?.sku === skuIn) ||
        (p.product && p.product.metadata?.sku === skuIn)
      ) || null;
    }

    if (!price) return resp(400, { error: 'PRICE_NOT_FOUND' });

    // ---- determina mode in base al price
    const isRecurring = !!price.recurring;   // se c'è p.recurring è un abbonamento
    const mode = isRecurring ? 'subscription' : 'payment';

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
      (event.headers?.origin && /^https?:\/\//.test(event.headers.origin) ? event.headers.origin : 'https://colpamia.com');

    // ---- parametri sessione
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
      // facoltativi
      // allow_promotion_codes: true,
      // billing_address_collection: 'auto',
      // phone_number_collection: { enabled: true },
      metadata: { origin: 'colpamia', responsabile }, // utile per debug
    };

    if (existingCustomer) {
      params.customer = existingCustomer.id;
    } else if (email) {
      params.customer_email = email;
      params.customer_creation = 'if_required';
    }

    const session = await stripe.checkout.sessions.create(params);
    return resp(200, { url: session.url, id: session.id, mode });

  } catch (e) {
    console.error('CHECKOUT_ERROR', e);
    // Rimanda info utili al frontend per capire il motivo
    return resp(500, { error: e?.message || 'INTERNAL_ERROR' });
  }
};
