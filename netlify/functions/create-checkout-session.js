// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// === Mappa fissa SKU -> price_ (Strada A) ===
// COMPILA con i tuoi price_ corretti (stesso ambiente della chiave: test vs live)
const PRICE_BY_SKU = {
  SCUSA_ENTRY:  'price_1S3O3BAuMAjkbPdH40irfbqa', // 0,50 € (già fornito)
  // Sostituisci gli XXXXX con i tuoi price reali:
  SCUSA_BASE:   'price_XXXXXXXXXXXXXX',            // 1,00 €
  SCUSA_TRIPLA: 'price_XXXXXXXXXXXXXX',            // 2,50 €
  SCUSA_DELUXE: 'price_XXXXXXXXXXXXXX',            // 4,50 €
  RIUNIONE:     'price_XXXXXXXXXXXXXX',            // 2,00 €
  TRAFFICO:     'price_XXXXXXXXXXXXXX',            // 2,00 €
  CONN_KO:      'price_1Sw4RAuMAjkbPdHLFPElLnX',   // dal tuo screenshot
};

const j = (s, b) => ({
  statusCode: s,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

    // ---- parse input (POST o GET)
    let body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else if (event.httpMethod === 'GET') {
      const q = new URLSearchParams(event.queryStringParameters || {});
      body = { sku: q.get('sku'), email: q.get('email'), qty: q.get('qty') };
    } else {
      return j(405, { error: 'METHOD_NOT_ALLOWED' });
    }

    const sku  = String(body.sku || '').trim().toUpperCase();
    const email = String(body.email || '').trim().toLowerCase();
    const qty   = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    if (!sku) return j(400, { error: 'SKU_REQUIRED' });

    // ---- risoluzione price
    let priceId = PRICE_BY_SKU[sku];
    let price = null;

    if (priceId) {
      try {
        price = await stripe.prices.retrieve(priceId);
        if (!price?.active) throw new Error('PRICE_NOT_ACTIVE');
      } catch (e) {
        console.error('PRICE_BY_SKU retrieve failed', { sku, priceId, msg: e?.message });
        return j(400, { error: 'PRICE_RETRIEVE_FAILED', detail: { sku, priceId, message: e?.message } });
      }
    } else {
      // Fallback: cerca per metadata.sku su price o product (così non si blocca se hai dimenticato la mappa)
      try {
        const list = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
        price = list.data.find(p =>
          (p.metadata?.sku && String(p.metadata.sku).toUpperCase() === sku) ||
          (p.product?.metadata?.sku && String(p.product.metadata.sku).toUpperCase() === sku)
        ) || null;
        if (!price) {
          return j(400, { error: 'PRICE_NOT_MAPPED', detail: { sku, hint: 'Aggiungi lo SKU a PRICE_BY_SKU o imposta metadata.sku in Stripe' } });
        }
        priceId = price.id;
      } catch (e) {
        console.error('prices.list failed', e?.message);
        return j(500, { error: 'PRICE_LOOKUP_FAILED', detail: { sku, message: e?.message } });
      }
    }

    // ---- riuso cliente (opzionale)
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

    // ---- URL sito
    const site =
      process.env.SITE_URL ||
      (/^https?:\/\//.test(event.headers?.origin || '') ? event.headers.origin : 'https://colpamia.com');

    // ---- crea sessione
    const params = {
      mode: 'payment',
      line_items: [{ price: priceId, quantity: qty }],
      success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/cancel`,
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
    console.error('create-checkout-session fatal:', e);
    return j(500, { error: e?.message || 'INTERNAL_ERROR' });
  }
};
