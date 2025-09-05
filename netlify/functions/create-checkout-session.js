// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resp(status, body, extra = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
    body: JSON.stringify(body),
  };
}

function getOrigin(event) {
  const h = event.headers || {};
  const xfHost = h['x-forwarded-host'] || h['X-Forwarded-Host'];
  const host = xfHost || h.host || h.Host;
  const proto = (h['x-forwarded-proto'] || 'https');
  return process.env.SITE_URL || `${proto}://${host}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, {});
  if (event.httpMethod !== 'POST') return resp(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'bad_json' }); }

  const sku = String(body.sku || '').trim();
  if (!sku) return resp(400, { error: 'missing_sku' });

  // 1) prova da ENV (JSON: {"SCUSA_ENTRY":"price_...","SCUSA_BASE":"price_..."})
  let map = {};
  try { map = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}'); } catch { map = {}; }
  let priceId = map[sku];

  // 2) fallback: lookup_key in Stripe = SKU
  if (!priceId) {
    try {
      const list = await stripe.prices.list({ lookup_keys: [sku], active: true, limit: 1 });
      priceId = list?.data?.[0]?.id || null;
    } catch (_) {}
  }

  if (!priceId) return resp(400, { error: `price_not_found_for_sku:${sku}` });

  const origin = getOrigin(event);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
      allow_promotion_codes: false,
      customer_creation: 'always',
      phone_number_collection: { enabled: true },
      custom_fields: [
        { key: 'phone', label: { type: 'custom', custom: 'Telefono WhatsApp (opz.)' }, type: 'text', optional: true },
        { key: 'need',  label: { type: 'custom', custom: 'Contesto (opz.)' },            type: 'text', optional: true },
      ],
      metadata: { sku }
    });

    return resp(200, { url: session.url });
  } catch (err) {
    return resp(500, { error: String(err?.message || 'stripe_error') });
  }
};
