// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type':'application/json', ...CORS }, body: JSON.stringify(b) });

function priceFromEnv(sku) {
  // mappa JSON nelle env: {"SCUSA_BASE":"price_...","SCUSA_DELUXE":"price_...","CONNESSIONE":"price_...","TRAFFICO":"price_...","RIUNIONE":"price_..."}
  const raw = process.env.PRICE_BY_SKU_JSON || '';
  if (!raw) return null;
  try { const map = JSON.parse(raw); return map[String(sku||'').toUpperCase()] || null; } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const sku         = String(body.sku || '').toUpperCase();
  const passedPrice = String(body.price_id || '').trim() || null;
  const successUrl  = String(body.success_url || '').trim();
  const cancelUrl   = String(body.cancel_url  || '').trim();
  const needLabel   = String(body.need_label  || 'Contesto (obbligatorio: 4–120 caratteri)');
  const needDefault = (body.need_default ? String(body.need_default) : '');

  if (!sku)         return j(400, { error: 'missing_sku' });
  if (!successUrl)  return j(400, { error: 'missing_success_url' });
  if (!cancelUrl)   return j(400, { error: 'missing_cancel_url' });

  // Se non passa price_id dal frontend, recuperalo dalla mappa ambiente
  const priceId = passedPrice || priceFromEnv(sku);
  if (!priceId) return j(400, { error: 'no_price_for_sku', sku });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sku,              // usato dal webhook per capire il “kind”
      customer_creation: 'always',
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url:  cancelUrl,
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
          label: { type: 'custom', custom: needLabel },
          type: 'text',
          optional: false,
          text: {
            value: needDefault || null,
            minimum_length: 4,
            maximum_length: 120
          }
        }
      ],
      line_items: [{ price: priceId, quantity: 1 }],
      // opzionale: metadata utili al webhook/debug
      metadata: { sku, source: 'site-index' }
    });

    return j(200, { id: session.id, url: session.url });
  } catch (err) {
    return j(500, { error: 'stripe_error', detail: String(err?.message || err) });
  }
};
