// netlify/functions/create-checkout-session.js
// Accetta POST (normale) e GET (fallback) per evitare "Method Not Allowed".
// Cerca il Price su Stripe tramite metadata['sku'] e crea una checkout session.

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// CORS (utile su preview / locale)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: cors };
    }

    // Dati in input: preferisci POST JSON { sku }, ma accettiamo anche GET ?sku=...
    let sku = null;

    if (event.httpMethod === 'POST') {
      try {
        const body = JSON.parse(event.body || '{}');
        sku = body.sku;
      } catch (e) {
        // body non JSON -> ignora
      }
    } else if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      sku = params.get('sku') || params.get('SKU') || null;
    } else {
      // Altre method -> 405
      return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
    }

    if (!sku || typeof sku !== 'string') {
      return { statusCode: 400, headers: cors, body: 'Missing sku' };
    }

    // Cerca il Price attivo con metadata['sku'] = SKU
    // (Se non trovi niente, tenta anche product.metadata['sku'])
    let price = null;

    // 1) Ricerca su price.metadata.sku
    const byPriceMd = await stripe.prices.search({
      // escape semplice per l'apice singolo
      query: `active:'true' AND metadata['sku']:'${sku.replace(/'/g, "\\'")}'`,
      limit: 1,
    });

    if (byPriceMd.data.length > 0) {
      price = byPriceMd.data[0];
    } else {
      // 2) Ricerca su product.metadata.sku
      const byProdMd = await stripe.prices.search({
        query: `active:'true' AND product.metadata['sku']:'${sku.replace(/'/g, "\\'")}'`,
        limit: 1,
      });
      if (byProdMd.data.length > 0) {
        price = byProdMd.data[0];
      }
    }

    if (!price) {
      return {
        statusCode: 400,
        headers: cors,
        body: `SKU not found or product has no price (sku=${sku})`,
      };
    }

    const SITE_URL = process.env.SITE_URL || 'https://colpamia.com';
    const successUrl = `${SITE_URL}/success.html`;
    const cancelUrl  = `${SITE_URL}/index.html#catalogo`;

    // Crea sessione
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,

      // Se vuoi, passa metadati per il post-processing nel webhook:
      client_reference_id: sku,
      metadata: { sku },
      allow_promotion_codes: true,
      // Nota: per email precompilata usa customer_email (se la conosci)
      // customer_email: 'facoltativo@esempio.com',
    });

    // Se la richiesta era GET → redirect 303
    if (event.httpMethod === 'GET') {
      return {
        statusCode: 303,
        headers: { ...cors, Location: session.url },
        body: '',
      };
    }

    // POST → ritorno JSON
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('create-checkout-session error:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: 'Internal Server Error',
    };
  }
};


