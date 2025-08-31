// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Utility per costruire l'URL del sito in modo sicuro (Netlify)
function siteOrigin() {
  // Se hai messo SITE_URL nelle env, usa quella (consigliato)
  const fromEnv = process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Fallback a URL fornita da Netlify
  const fromNetlify = process.env.URL || process.env.DEPLOY_URL;
  if (fromNetlify) return fromNetlify.replace(/\/$/, '');
  // Ultimo fallback (non dovrebbe servire in produzione)
  return 'http://localhost:8888';
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let sku;
    try {
      const body = JSON.parse(event.body || '{}');
      sku = body.sku;
    } catch (_) {}
    if (!sku) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing sku' }) };
    }

    // 🔎 Trova il prodotto in Stripe usando metadata.sku === sku
    // (così evitiamo ricerche deprecate/parametri non supportati)
    const products = await stripe.products.list({ active: true, limit: 100 });
    const prod = products.data.find(
      (p) => p?.metadata?.sku && p.metadata.sku === sku
    );

    if (!prod || !prod.default_price) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'SKU not found or product has no price' }),
      };
    }

    const priceId =
      typeof prod.default_price === 'string'
        ? prod.default_price
        : prod.default_price.id;

    const origin = siteOrigin();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_creation: 'if_required',
      // ➜ Portiamo il cliente su success con la sessione per auto-ricavare l’email
      success_url: `${origin}/success.html?sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    // 303 + Location (Netlify segue bene)
    return {
      statusCode: 303,
      headers: { Location: session.url },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
