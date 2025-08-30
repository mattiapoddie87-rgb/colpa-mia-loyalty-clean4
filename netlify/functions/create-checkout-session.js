// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');

const CATALOG = {
  'SCUSA_BASE':     { eur: 100, minutes: 10, title: 'Scusa Base',     desc: 'La più usata, funziona sempre.' },
  'SCUSA_TRIPLA':   { eur: 250, minutes: 30, title: 'Scusa Tripla',   desc: 'Tre scuse diverse in un solo pacchetto.' },
  'SCUSA_DELUXE':   { eur: 450, minutes: 60, title: 'Scusa Deluxe',   desc: 'Perfetta, elegante, inattaccabile.' },
  'RIUNIONE':       { eur: 200, minutes: 20, title: 'Riunione improvvisa', desc: 'Alibi perfetto in orario d’ufficio.' },
  'TRAFFICO':       { eur: 200, minutes: 20, title: 'Traffico assurdo', desc: 'Sempreverde, valido ovunque.' },
  'CONN_KO':        { eur: 200, minutes: 20, title: 'Connessione KO', desc: 'Speciale smartworking edition.' },
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { sku } = JSON.parse(event.body || '{}');
    if (!sku || !CATALOG[sku]) {
      console.error('SKU mancante o non valido', sku);
      return { statusCode: 400, body: JSON.stringify({ error: 'SKU non valido' }) };
    }

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error('STRIPE_SECRET_KEY mancante');
      return { statusCode: 500, body: JSON.stringify({ error: 'Stripe key mancante' }) };
    }
    const stripe = new Stripe(key);

    const siteUrl = process.env.SITE_URL || `https://${event.headers.host}`;
    const item = CATALOG[sku];

    // 1) Trova o crea Product per SKU
    const prodSearch = await stripe.products.search({ query: `metadata['sku']:'${sku}'` });
    const product = prodSearch.data[0] || await stripe.products.create({
      name: item.title,
      description: item.desc,
      metadata: { sku, minutes: String(item.minutes) }
    });

    // 2) Trova Price attivo per lo stesso product con currency EUR e unit_amount esatto (filtra via list)
    const priceList = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 100
    });
    let price = priceList.data.find(p => p.currency === 'eur' && p.unit_amount === item.eur);

    // Se non esiste, crealo
    if (!price) {
      price = await stripe.prices.create({
        currency: 'eur',
        unit_amount: item.eur,          // valori in centesimi: 100 = €1.00
        product: product.id,
        metadata: { sku, minutes: String(item.minutes) }
      });
    }

    // 3) Crea la Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${siteUrl}/success.html`,
      cancel_url: `${siteUrl}/cancel.html`,
      allow_promotion_codes: true
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };

  } catch (err) {
    console.error('Checkout error:', err);
    const msg = err && err.message ? err.message : 'Errore interno';
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
};

