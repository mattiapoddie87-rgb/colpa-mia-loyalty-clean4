// netlify/functions/create-checkout-session.js
// Crea una Stripe Checkout Session per un singolo SKU.
// Supporta PROMO CODE (allow_promotion_codes: true) e crea sempre un Customer.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b,h={}) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS, ...h },
  body: JSON.stringify(b),
});

// URL base del sito
const origin = (e) =>
  process.env.SITE_URL ||
  `${(e.headers['x-forwarded-proto'] || 'https')}://${(e.headers['x-forwarded-host'] || e.headers.host)}`;

// SKU ammessi (hard guard-rail)
const ALLOWED_SKU = new Set([
  'SCUSA_ENTRY','SCUSA_BASE','SCUSA_TRIPLA','SCUSA_DELUXE',
  'CONS_KO','RIUNIONE','TRAFFICO'
]);

// parsing sicuro della mappa ENV (SKU -> price_id)
function readPriceMap(){
  try { return JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}'); }
  catch { return {}; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  // ---- payload
  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return j(400, { error: 'bad_json' }); }

  const sku = String(body.sku || '').trim().toUpperCase();
  if (!sku) return j(400, { error: 'missing_sku' });
  if (!ALLOWED_SKU.has(sku)) return j(400, { error: `price_not_found_for_sku:${sku}` });

  // ---- risolviamo il price
  const map = readPriceMap();         // esempio: { "SCUSA_BASE": "price_123" }
  let priceId = map[sku] || null;

  // fallback: cerca price per lookup_key = SKU
  if (!priceId) {
    try {
      const r = await stripe.prices.list({ lookup_keys: [sku], active: true, limit: 1 });
      priceId = r?.data?.[0]?.id || null;
    } catch {/* ignore */}
  }
  if (!priceId) return j(400, { error: `price_not_found_for_sku:${sku}` });

  // ---- crea la sessione
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],

      // ✅ campo "Codice promozionale" su Checkout
      allow_promotion_codes: true,

      // ✅ vogliamo SEMPRE un Customer (serve al wallet)
      customer_creation: 'always',

      // ✅ numero telefono e campo contesto
      phone_number_collection: { enabled: true },
      custom_fields: [
        {
          key: 'phone',
          label: { type: 'custom', custom: 'Telefono WhatsApp (opz.)' },
          type: 'text',
          optional: true,
        },
        {
          key: 'need',
          label: { type: 'custom', custom: 'Contesto (opz.)' },
          type: 'text',
          optional: true,
        },
      ],

      // utili al webhook e ai log
      client_reference_id: sku,
      metadata: { sku },

      // redirect
      success_url: `${origin(event)}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin(event)}/cancel.html?sku=${encodeURIComponent(sku)}`,
    });

    return j(200, { url: session.url });
  } catch (err) {
    // non ritorniamo dettagli sensibili
    return j(500, { error: String(err?.message || 'stripe_error') });
  }
};
