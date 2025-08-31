// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Ricava l'origin del sito (usa SITE_URL se presente)
function siteOrigin() {
  const fromEnv = process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const fromNetlify = process.env.URL || process.env.DEPLOY_URL;
  if (fromNetlify) return fromNetlify.replace(/\/$/, '');
  return 'http://localhost:8888';
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 1) Leggi SKU dal body
    let sku;
    try {
      sku = (JSON.parse(event.body || '{}')).sku;
    } catch (_) {}
    if (!sku) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing sku' }) };
    }

    // 2) Trova il Product con metadata.sku === sku
    const products = await stripe.products.list({ active: true, limit: 100 });
    const prod = products.data.find(p => p?.metadata?.sku === sku);

    if (!prod) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Product not found for sku ${sku}. Assicurati di avere metadata.sku="${sku}" su Stripe.` }),
      };
    }

    // 3) Recupera un Price: prima default_price, altrimenti il primo price attivo del product
    let priceId = null;

    if (prod.default_price) {
      priceId = typeof prod.default_price === 'string'
        ? prod.default_price
        : prod.default_price.id;
    } else {
      const prices = await stripe.prices.list({ product: prod.id, active: true, limit: 100 });
      // prova a preferire EUR se disponibile
      const eurFirst = prices.data.find(pr => pr.currency === 'eur') || prices.data[0];
      if (eurFirst) priceId = eurFirst.id;
    }

    if (!priceId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `No active price for product sku ${sku}. Aggiungi un Price attivo al Product (anche come default_price).` }),
      };
    }

    const origin = siteOrigin();

    // 4) Crea la Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_creation: 'if_required',
      success_url: `${origin}/success.html?sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
    });

    // 5) Redirect 303 (Netlify-friendly)
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
