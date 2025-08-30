// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Catalogo server-side (EUR in centesimi). lookup_key = SKU
const CATALOG = {
  SCUSA_BASE:   { name:'Scusa Base',        amount:100, minutes:10,  description:'La più usata, funziona sempre.' },
  SCUSA_TRIPLA: { name:'Scusa Tripla',      amount:250, minutes:30,  description:'Tre scuse diverse in un solo pacchetto.' },
  SCUSA_DELUXE: { name:'Scusa Deluxe',      amount:450, minutes:60,  description:'Perfetta, elegante, inattaccabile.' },
  RIUNIONE:     { name:'Riunione improvvisa', amount:200, minutes:20, description:'Alibi perfetto in orario d’ufficio.' },
  TRAFFICO:     { name:'Traffico assurdo',  amount:200, minutes:20,  description:'Sempreverde, valido ovunque.' },
  CONN_KO:      { name:'Connessione KO',    amount:200, minutes:20,  description:'Speciale smartworking edition.' },
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    if (!process.env.STRIPE_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY' }) };

    const { sku } = JSON.parse(event.body || '{}');
    const item = CATALOG[sku];
    if (!item) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid SKU' }) };

    // Trova Price by lookup_key, altrimenti crea Product+Price
    const found = await stripe.prices.list({ lookup_keys: [sku], active: true, limit: 1, expand: ['data.product'] });
    let price = found.data[0];
    if (!price) {
      const product = await stripe.products.create({
        name: item.name,
        description: item.description,
        metadata: { minutes: String(item.minutes), sku }
      });
      price = await stripe.prices.create({
        currency: 'eur',
        unit_amount: item.amount,
        product: product.id,
        lookup_key: sku,
        metadata: { minutes: String(item.minutes), sku }
      });
    }

    const siteUrl = process.env.SITE_URL || `${(event.headers['x-forwarded-proto'] || 'https')}://${event.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: true,
      customer_creation: 'always',
      success_url: `${siteUrl}/success.html?m=${item.minutes}&e=${item.amount}&s=${encodeURIComponent(item.name)}`,
      cancel_url: `${siteUrl}/cancel.html`,
      metadata: { minutes: String(item.minutes), sku }
    });

    return { statusCode: 303, headers: { Location: session.url } };
  } catch (err) {
    console.error('Stripe error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe error', details: err.message }) };
  }
};
