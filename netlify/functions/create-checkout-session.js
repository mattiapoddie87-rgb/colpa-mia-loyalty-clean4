// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const {
    price_id,      // può arrivare già dal client
    sku,           // SCUSA_BASE, SCUSA_DELUXE, CONNESSIONE, TRAFFICO, RIUNIONE, COLPA_LIGHT, COLPA_FULL, COLPA_DELUXE
    success_url,
    cancel_url,
    need_default = '' // valore precompilato per il campo "Contesto" (SOLTANTO Base/Deluxe)
  } = body;

  // Mappa prezzi da env
  let mapping = {};
  try { mapping = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}'); } catch {}
  const resolvedPrice = price_id || mapping[sku];

  if (!resolvedPrice) return j(400, { error: 'missing_price', detail: `Nessun price per sku=${sku}` });
  if (!success_url || !cancel_url) return j(400, { error: 'missing_urls' });

  // solo Base/Deluxe vogliono il campo "Contesto"
  const wantsContext = (sku === 'SCUSA_BASE' || sku === 'SCUSA_DELUXE');
  const ctx = String(need_default || '').trim();

  // ATTENZIONE: label corta per non superare 50 char
  const customFields = wantsContext ? [{
    key: 'need',
    type: 'text',
    optional: true,
    label: { type: 'custom', custom: 'Contesto' }, // <= 50 char
    text: { default_value: ctx.slice(0, 120) }     // sicurezza, max 120
  }] : [];

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url,
      cancel_url,
      line_items: [{ price: resolvedPrice, quantity: 1 }],
      allow_promotion_codes: true,
      customer_creation: 'always',
      ui_mode: 'hosted',
      // Per i pacchetti "Prendo io la colpa" NON vogliamo alcun campo contesto
      custom_fields: customFields,
      metadata: {
        sku: sku || '',
        contextPrefill: ctx
      }
    });

    return j(200, { id: session.id, url: session.url });
  } catch (err) {
    // ritorna il messaggio utile a debug
    return j(500, { error: 'stripe_create_failed', message: String(err.message || err) });
  }
};
