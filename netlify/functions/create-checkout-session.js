// netlify/functions/create-checkout-session.js
// Supporta sia { priceId } sia { sku }.
// Se arriva sku: cerca in Stripe il prezzo attivo del prodotto con metadata.sku === sku

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// helper: trova un priceId partendo dallo SKU via metadata
async function getPriceIdFromSku(sku) {
  // Prendiamo un po' di prezzi attivi e includiamo il prodotto
  const prices = await stripe.prices.list({
    active: true,
    limit: 100,
    expand: ['data.product'],
  });

  // Cerca il primo price che ha product.metadata.sku == sku
  const match = prices.data.find((p) => {
    const md = p.product && p.product.metadata ? p.product.metadata : {};
    return (md.sku && md.sku.toUpperCase() === String(sku).toUpperCase());
  });

  return match ? match.id : null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { priceId, sku, email } = JSON.parse(event.body || '{}');

    let finalPriceId = priceId;

    // Se non è stato passato un priceId, proviamo con lo sku
    if (!finalPriceId && sku) {
      finalPriceId = await getPriceIdFromSku(sku);
    }

    if (!finalPriceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing priceId and/or unknown sku' }),
      };
    }

    const siteUrl = process.env.SITE_URL || process.env.URL || 'http://localhost:8888';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: finalPriceId, quantity: 1 }],
      customer_email: email || undefined, // opzionale
      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cancel.html`,
    });

    // Ritorno JSON con la URL (il client fa location.href=data.url)
    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };

  } catch (e) {
    console.error('checkout error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

