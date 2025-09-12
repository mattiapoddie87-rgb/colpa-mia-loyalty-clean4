// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SITE = process.env.SITE_URL || 'https://colpamia.com';

// SKU che NON devono mostrare il campo "Contesto"
function noContextSKU(sku) {
  const s = String(sku || '').toUpperCase();
  return s.includes('TRAFFICO') || s.includes('RIUNIONE') || s.includes('CONNESSIONE');
}

// se il menu a tendina ha già deciso il contesto, non chiedere nulla
function shouldAskContext(sku, presetNeed) {
  if (noContextSKU(sku)) return false;
  if (presetNeed && String(presetNeed).trim().length >= 4) return false;
  return true;
}

function customFieldsFor(sku, presetNeed) {
  const fields = [
    {
      key: 'phone',
      label: { type: 'custom', custom: 'Telefono WhatsApp (opz.)' },
      optional: true,
      type: 'text',
      text: { maximum_length: 20 }
    }
  ];
  if (shouldAskContext(sku, presetNeed)) {
    fields.push({
      key: 'need',
      label: { type: 'custom', custom: 'Contesto (obbligatorio: 4–120 caratteri)' },
      optional: false,
      type: 'text',
      text: { minimum_length: 4, maximum_length: 120 }
    });
  }
  return fields;
}

function getPriceIdForSKU(sku) {
  const map = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
  return map[sku];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const sku = String(body.sku || 'SCUSA_BASE');
  const qty = Number(body.quantity || 1);

  // dal menu a tendina: body.need oppure body.context
  const presetNeed = (body.need || body.context || '').trim();

  const priceId = getPriceIdForSKU(sku);
  if (!priceId) return { statusCode: 400, body: `SKU non valido: ${sku}` };

  const params = {
    mode: 'payment',
    line_items: [{ price: priceId, quantity: qty }],
    success_url: `${SITE}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/cancel.html`,
    allow_promotion_codes: true,
    customer_creation: 'always',
    phone_number_collection: { enabled: true },
    client_reference_id: sku,
    metadata: { sku }
  };

  // se il contesto è già deciso, lo salvo in metadata e NON mostro il campo
  if (presetNeed) params.metadata.need = presetNeed;

  params.custom_fields = customFieldsFor(sku, presetNeed);

  try {
    const session = await stripe.checkout.sessions.create(params);
    return { statusCode: 200, body: JSON.stringify({ id: session.id, url: session.url }) };
  } catch (e) {
    console.error('Errore creazione sessione:', e.message);
    return { statusCode: 500, body: 'create_session_failed' };
  }
};
