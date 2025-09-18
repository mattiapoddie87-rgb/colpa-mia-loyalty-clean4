// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Mappa SKU → priceId (oppure usa prices dinamici come già fai)
const PRICE_BY_SKU = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch {}

  const {
    sku = '',
    success_url = `${process.env.ENTRY_LINK || ''}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url = `${process.env.ENTRY_LINK || ''}/cancel.html`,
    need_default = '',          // contesto scelto dalla tendina
    context_hint = '',          // idem
    need_mode = ''              // se "locked" non mostrare il campo
  } = payload;

  if (!sku) return { statusCode: 400, body: 'missing_sku' };

  // line items
  let priceId = PRICE_BY_SKU[sku];
  // Se non usi priceId fissi, qui puoi costruire items via sku → amount/descrizione
  const lineItems = priceId ? [{ price: priceId, quantity: 1 }] : [{ quantity: 1, price_data: {
    currency: 'eur',
    unit_amount: 100, // fallback
    product_data: { name: sku }
  }}];

  // Metadata da portare al webhook / email
  const ctx = (need_default || context_hint || '').toString().trim();
  const metadata = { sku, ctx };

  // --- COSTRUZIONE CHECKOUT ---
  // Se ho già il contesto (o need_mode==='locked'), NON aggiungo custom_fields
  // → così su Stripe non compare il campo "Contesto".
  const custom_fields = [];

  // Se vuoi mantenerlo opzionale quando manca del tutto:
  if (!ctx && need_mode !== 'locked') {
    custom_fields.push({
      key: 'need',
      label: { type: 'custom', custom: 'Contesto' },
      type: 'text',
      text: {
        maximum_length: 120,
        minimum_length: 4,
        // IMPORTANTE: NON obbligatorio
        // Stripe lo considera opzionale se non imponi "required": true (non metterlo)
      }
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      allow_promotion_codes: true,
      line_items: lineItems,
      success_url,
      cancel_url,
      custom_fields,
      metadata,
      // Precompila il campo “Descrizione” (facoltativo)
      invoice_creation: { enabled: false }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ id: session.id, url: session.url })
    };
  } catch (err) {
    console.error('stripe_error', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
