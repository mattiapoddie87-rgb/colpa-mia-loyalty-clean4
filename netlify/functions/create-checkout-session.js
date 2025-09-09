// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type':'application/json', ...CORS }, body: JSON.stringify(b) });

// Legge mappa prezzi da JSON in env; se fallisce ritorna {}
function mapFromJsonEnv() {
  const raw = process.env.PRICE_BY_SKU_JSON || '';
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Fallback su env singole (accetta più nomi “storici”)
function fallbackSingles() {
  const m = {};
  if (process.env.PRICE_SCUSA_BASE_ID)    m.SCUSA_BASE   = process.env.PRICE_SCUSA_BASE_ID;
  if (process.env.PRICE_SCUSA_DELUXE_ID)  m.SCUSA_DELUXE = process.env.PRICE_SCUSA_DELUXE_ID;
  if (process.env.PRICE_CONN_ID)          m.CONNESSIONE  = process.env.PRICE_CONN_ID;
  if (process.env.PRICE_TRAFF_ID)         m.TRAFFICO     = process.env.PRICE_TRAFF_ID;
  if (process.env.PRICE_RIUN_ID)          m.RIUNIONE     = process.env.PRICE_RIUN_ID;
  return m;
}

// Risolve price_id per SKU
function resolvePriceId(sku, passedPrice) {
  if (passedPrice) return passedPrice.trim();
  const skuU = String(sku||'').toUpperCase();
  const map = { ...mapFromJsonEnv(), ...fallbackSingles() };
  return map[skuU] || null;
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

  if (!sku)        return j(400, { error: 'missing_sku' });
  if (!successUrl) return j(400, { error: 'missing_success_url' });
  if (!cancelUrl)  return j(400, { error: 'missing_cancel_url' });

  const priceId = resolvePriceId(sku, passedPrice);
  if (!priceId) {
    return j(400, {
      error: 'missing_price_mapping',
      message: `Manca il price_id per SKU=${sku}.`,
      hint: 'Imposta PRICE_BY_SKU_JSON oppure le env singole (PRICE_CONN_ID, PRICE_TRAFF_ID, PRICE_RIUN_ID, PRICE_SCUSA_BASE_ID, PRICE_SCUSA_DELUXE_ID).'
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sku,
      customer_creation: 'always',
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url:  cancelUrl,
      phone_number_collection: { enabled: true },
      custom_fields: [
        { key:'phone', label:{ type:'custom', custom:'Telefono WhatsApp (opz.)' }, type:'text', optional:true },
        { key:'need',  label:{ type:'custom', custom:needLabel }, type:'text', optional:false,
          text:{ value: needDefault || null, minimum_length:4, maximum_length:120 } }
      ],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { sku, source: 'site-index' }
    });

    return j(200, { id: session.id, url: session.url });
  } catch (err) {
    // esempi utili: “No such price: 'price_xxx'” (mismatch live/test) ecc.
    return j(500, { error: 'stripe_error', detail: String(err?.message || err) });
  }
};
