// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PRICE_MAP = {
  RESPONSABILE_AZIENDA:    'price_1S3f7eAuMAjkbPdHwbD8XqtV',
  RESPONSABILE_INFLUENCER: 'price_1S3fhAAuMAjkbPdHVRWBXJt5',
  RESPONSABILE_CRISI:      'price_1S3fjaAuMAjkbPdHzSuZksed',
};

// 🔴 COMPILA TUTTI gli SKU con i tuoi price_… reali da Stripe
const PRICE_BY_SKU = {
  SCUSA_ENTRY:  'price_1S3O3BAuMAjkbPdH40irfbqa', // 0,50 €
  SCUSA_BASE:   'price_XXXXXXXXXXXXXXXXXXXXXXX',   // 1,00 €
  SCUSA_TRIPLA: 'price_XXXXXXXXXXXXXXXXXXXXXXX',   // 2,50 €
  SCUSA_DELUXE: 'price_XXXXXXXXXXXXXXXXXXXXXXX',   // 4,50 €
  RIUNIONE:     'price_XXXXXXXXXXXXXXXXXXXXXXX',   // 2,00 €
  TRAFFICO:     'price_XXXXXXXXXXXXXXXXXXXXXXX',   // 2,00 €
  CONN_KO:      'price_XXXXXXXXXXXXXXXXXXXXXXX',   // 2,00 €
};

const j = (s,b)=>({ statusCode:s, headers:{...CORS,'Content-Type':'application/json'}, body:JSON.stringify(b) });

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

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
      return j(405, { error: 'METHOD_NOT_ALLOWED' });
    }

    const email        = String(body.email || '').trim().toLowerCase();
    const priceIdIn    = String(body.priceId || '').trim();
    const sku          = String(body.sku || '').trim().toUpperCase();
    const responsabile = String(body.responsabile || '').trim().toUpperCase();
    const qty          = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    let price = null;

    if (!price && priceIdIn) {
      const p = await stripe.prices.retrieve(priceIdIn);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      price = p;
    }

    if (!price && responsabile) {
      const id = PRICE_MAP[responsabile];
      if (!id) return j(400, { error:'RESPONSABILE_NOT_MAPPED', detail:{ responsabile } });
      const p = await stripe.prices.retrieve(id);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      price = p;
    }

    if (!price && sku) {
      const id = PRICE_BY_SKU[sku];
      if (!id) return j(400, { error:'PRICE_NOT_FOUND', detail:{ sku, hint:'aggiungi price a PRICE_BY_SKU oppure metadata.sku in Stripe' } });
      const p = await stripe.prices.retrieve(id);
      if (!p?.active) throw new Error('PRICE_NOT_ACTIVE');
      price = p;
    }

    // customer reuse
    let customer = null;
    if (email) {
      try {
        const r = await stripe.customers.search({ query:`email:"${email}"`, limit:1 });
        customer = r.data[0] || null;
      } catch {
        const r2 = await stripe.customers.list({ email, limit:1 });
        customer = r2.data[0] || null;
      }
    }

    const site =
      process.env.SITE_URL ||
      (/^https?:\/\//.test(event.headers?.origin||'') ? event.headers.origin : 'https://colpamia.com');

    const params = {
      mode: 'payment',
      line_items: [{ price: price.id, quantity: qty }],
      success_url: `${site}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${site}/cancel`,
      custom_fields: [{
        key:'need', label:{type:'custom',custom:'Esigenza (facoltativa)'}, type:'text', optional:true
      }],
    };
    if (customer) params.customer = customer.id;
    else if (email) { params.customer_email = email; params.customer_creation = 'if_required'; }

    const session = await stripe.checkout.sessions.create(params);
    return j(200, { url: session.url, id: session.id });

  } catch (e) {
    return j(500, { error: e.message || 'INTERNAL_ERROR' });
  }
};
