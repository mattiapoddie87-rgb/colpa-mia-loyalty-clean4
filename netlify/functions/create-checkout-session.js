// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');

const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const SITE    = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/, '');
const CORS    = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type':'application/json', ...CORS }, body: JSON.stringify(b) });
const safeJSON = (s)=>{ try { return JSON.parse(s || '{}'); } catch { return {}; } };

const PRICE_MAP = safeJSON(process.env.PRICE_BY_SKU_JSON); // {SKU: price_xxx}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return j(400, { error: 'bad_json' }); }

  const sku      = String(body.sku || '').toUpperCase();
  let   priceId  = String(body.price_id || '').trim();
  if (!priceId && sku && PRICE_MAP[sku]) priceId = PRICE_MAP[sku];

  if (!priceId) return j(400, { error:'missing_price_id', hint:'Pass price_id in body o configura PRICE_BY_SKU_JSON' });

  // success deve contenere {CHECKOUT_SESSION_ID}
  let success = String(body.success_url || `${SITE}/success.html`);
  if (!success.includes('{CHECKOUT_SESSION_ID}')) {
    success += (success.includes('?') ? '&' : '?') + 'session_id={CHECKOUT_SESSION_ID}';
  }
  const cancel  = String(body.cancel_url  || `${SITE}/cancel.html?sku=${encodeURIComponent(sku)}`);

  const needLabel   = String(body.need_label   || 'Contesto (obbligatorio: 4–120 caratteri)');
  const needDefault = String(body.need_default || '');

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_creation: 'always',
      client_reference_id: sku || 'UNKNOWN',
      metadata: { sku },
      phone_number_collection: { enabled: true },
      ui_mode: 'hosted',
      success_url: success,
      cancel_url:  cancel,
      custom_fields: [
        {
          key: 'phone',
          label: { type: 'custom', custom: 'Telefono WhatsApp (opz.)' },
          type: 'text',
          optional: true,
          text: { maximum_length: 20 }
        },
        {
          key: 'need',
          label: { type: 'custom', custom: needLabel },
          type: 'text',
          optional: false,
          text: { minimum_length: 4, maximum_length: 120, default_value: needDefault || undefined }
        }
      ]
    });

    return j(200, { ok:true, id: session.id, url: session.url });
  } catch (err) {
    // Risposta chiara in caso di errore Stripe
    return j(500, { error:'stripe_error', type: err?.type || null, message: String(err?.message || err) });
  }
};
