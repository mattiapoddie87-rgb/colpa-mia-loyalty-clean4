// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const ok = (b) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (s, m) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: m }) });

const SITE_URL = process.env.SITE_URL || 'https://colpamia.com';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = Stripe(STRIPE_SECRET_KEY);

// mappa SKU -> priceId (env JSON)
function loadPriceMap() {
  try { return JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}'); }
  catch { return {}; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return bad(405, 'method_not_allowed');

  try {
    const body = JSON.parse(event.body || '{}');
    const sku = String(body.sku || '').toUpperCase().trim();       // es. SCUSA_BASE | SCUSA_DELUXE | TRAFFICO | RIUNIONE | CONNESSIONE ...
    const ctx = String(body.ctx || '').toUpperCase().trim();        // es. CENA | CALCETTO | SALUTE ...
    const qty = Math.max(1, parseInt(body.quantity || 1, 10));

    if (!sku) return bad(400, 'sku_required');

    const prices = loadPriceMap();
    const priceId = prices[sku];
    if (!priceId) return bad(400, `unknown_sku:${sku}`);

    // quando NON mostrare il campo "Contesto"
    const fixedSkus = new Set(['TRAFFICO', 'RIUNIONE', 'CONNESSIONE']);
    const hideNeedField = fixedSkus.has(sku) || !!ctx;

    // campi custom
    const custom_fields = [];
    // telefono opzionale (come da setup precedente)
    custom_fields.push({
      key: 'phone',
      label: { type: 'custom', custom: 'Telefono WhatsApp (opz.)' },
      optional: true,
      type: 'text',
      text: { maximum_length: 20 },
    });
    // contesto visibile solo se serve davvero
    if (!hideNeedField) {
      custom_fields.push({
        key: 'need',
        label: { type: 'custom', custom: 'Contesto (obbligatorio: 4–120 caratteri)' },
        optional: false,
        type: 'text',
        text: { minimum_length: 4, maximum_length: 120 },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      allow_promotion_codes: true,
      customer_creation: 'always',
      payment_method_types: ['card', 'klarna', 'link', 'amazon_pay'],
      phone_number_collection: { enabled: true },

      line_items: [{ price: priceId, quantity: qty }],

      // routing
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/cancel.html`,

      // contesto forzato
      client_reference_id: ctx ? `SCUSA_${ctx}` : sku,
      metadata: {
        sku,
        ctx: ctx || '',
      },

      // form
      custom_fields,
    });

    return ok({ id: session.id, url: session.url });
  } catch (e) {
    return bad(500, String(e.message || e));
  }
};
