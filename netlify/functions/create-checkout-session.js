/*
 * Updated version of the create-checkout-session Netlify function.
 *
 * This variant extends the existing implementation by accepting an
 * additional `details` field from the checkout payload and storing
 * it in the session metadata.  Including `details` here allows
 * downstream functions (such as the AI-powered excuse generator)
 * to incorporate optional user-provided details directly into the
 * prompt sent to OpenAI.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const j = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body)
});

function parseEnvJSON(name) {
  try {
    return JSON.parse(process.env[name] || '{}');
  } catch {
    return {};
  }
}

// Price definitions and rules are supplied via environment variables.
const PRICE_BY_SKU = parseEnvJSON('PRICE_BY_SKU_JSON');
const PRICE_RULES  = parseEnvJSON('PRICE_RULES_JSON');

// Ensure the object isn't empty; avoids `Object.keys(...).length === 0` from
// failing Stripe calls downstream.
if (Object.keys(PRICE_BY_SKU).length === 0) {
  PRICE_BY_SKU.__dummy = 'dummy';
}

// SKU aliases allow the client to send simplified names that map back
// to canonical pricing identifiers.
const ALIAS = {
  BASE_5:    'COLPA_LIGHT',
  BASE_15:   'COLPA_FULL',
  PREMIUM_30:'COLPA_DELUXE'
};

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Helper to resolve a Stripe promotion code ID by code.  Returns null
// if no active promotion is found or the call fails.
async function resolvePromotionCodeId(code) {
  if (!code) return null;
  try {
    const promoList = await stripe.promotionCodes.list({ code: code, active: true, limit: 1 });
    return promoList?.data?.[0]?.id || null;
  } catch {
    return null;
  }
}

exports.handler = async (e) => {
  // Respond to preflight CORS requests.
  if (e.httpMethod === 'OPTIONS') return j(204, {});
  if (e.httpMethod !== 'POST') return j(405, { error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return j(500, { error: 'STRIPE_SECRET_KEY mancante' });

  try {
    // Parse request body.  Accept additional `details` field for optional
    // user-provided context to be passed along to the AI.
    const {
      sku: rawSku,
      email,
      title,
      context,
      message,
      tone,
      promo,
      details
    } = JSON.parse(e.body || '{}');

    if (!rawSku || !email) return j(400, { error: 'sku ed email obbligatori' });
    // Normalize SKU using alias map if necessary.
    const sku = PRICE_BY_SKU[rawSku] ? rawSku : (ALIAS[rawSku] || rawSku);
    const priceId = PRICE_BY_SKU[sku];
    const rules = PRICE_RULES[sku] || {};
    const origin = e.headers.origin || process.env.SITE_URL || 'https://colpamia.com';

    let promoId = null;
    if (promo) {
      promoId = await resolvePromotionCodeId(promo.trim());
    }
    let lineItems;
    if (priceId) {
      lineItems = [ { price: priceId, quantity: 1 } ];
    } else {
      // Fallback for SKUs not mapped to a price ID: use default €1 product.
      lineItems = [ {
        price_data: {
          currency: 'eur',
          product_data: { name: sku },
          unit_amount: 100,
        },
        quantity: 1
      } ];
    }

    // Build metadata for the session.  Include all optional fields if
    // supplied.  The `details` field is newly added to support
    // personalized excuses.
    const metadata = {};
    if (title) metadata.title = title;
    if (context) metadata.context = context;
    if (message) metadata.message = message;
    if (tone) metadata.tone = tone;
    if (details) metadata.details = details;
    metadata.sku = sku;
    if (rules.excuse) metadata.excuse = String(rules.excuse);
    if (rules.minutes) metadata.minutes = String(rules.minutes);

    const sessionParams = {
      mode: 'payment',
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html?canceled=1`,
      customer_email: email,
      line_items: lineItems,
      allow_promotion_codes: true,
      metadata
    };

    if (promoId) {
      // Only set discounts if we have a valid promotion code.
      sessionParams.discounts = [ { promotion_code: promoId } ];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return j(200, { url: session.url });
  } catch (err) {
    // Bubble up any unexpected errors as a 500 response.
    return j(500, { error: err.message || String(err) });
  }
};
