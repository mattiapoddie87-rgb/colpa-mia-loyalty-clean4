// netlify/functions/create-checkout-session.js
// ✅ CommonJS, retro-compatibile, checkout robusto (priceId o sku)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// URL del sito per i redirect
function siteOrigin() {
  const fromEnv = process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const fromNetlify = process.env.URL || process.env.DEPLOY_URL;
  if (fromNetlify) return fromNetlify.replace(/\/$/, '');
  return 'http://localhost:8888';
}

// Trova un priceId partendo dallo SKU (match su product.metadata.sku)
async function getPriceIdFromSku(sku) {
  // 1) Cerca tra i prices attivi espandendo il product (più veloce: un'unica chiamata)
  const prices = await stripe.prices.list({
    active: true,
    limit: 100,
    expand: ['data.product'],
  });

  const match = prices.data.find(p => {
    const md = p.product && p.product.metadata ? p.product.metadata : {};
    return (md.sku && String(md.sku).toUpperCase() === String(sku).toUpperCase());
  });

  if (match) return match.id;

  // 2) Fallback: lista products attivi e prendi default_price o primo price attivo
  const products = await stripe.products.list({ active: true, limit: 100 });
  const prod = products.data.find(p => p?.metadata?.sku && String(p.metadata.sku).toUpperCase() === String(sku).toUpperCase());
  if (!prod) return null;

  if (prod.default_price) {
    return typeof prod.default_price === 'string' ? prod.default_price : prod.default_price.id;
  }

  const prodPrices = await stripe.prices.list({ product: prod.id, active: true, limit: 100 });
  // preferisci EUR se presente
  const eur = prodPrices.data.find(pr => pr.currency === 'eur');
  return (eur || prodPrices.data[0])?.id || null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const origin = siteOrigin();

    // Supporto doppio: priceId diretto OPPURE sku → risolvo priceId
    let { priceId, sku } = body;
    if (!priceId && sku) {
      priceId = await getPriceIdFromSku(sku);
    }
    if (!priceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'SKU non riconosciuto o nessun price attivo. Verifica metadata.sku e i prezzi in Stripe.' }),
      };
    }

    // Metadata opzionali dal Motore AI: pass-through senza toccare il resto del flow
    const meta = {};
    ['draft_id', 'tone', 'dest', 'channel', 'phone', 'email'].forEach(k => {
      if (body && body[k] != null && body[k] !== '') meta[k] = String(body[k]);
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_creation: 'if_required',
      // compatibilità success: fornisco sia sid che session_id
      success_url: `${origin}/success.html?sid={CHECKOUT_SESSION_ID}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
      // NON tocco l'email cliente; se vuoi forzarla, passa body.email e scommenta:
      // customer_email: body.email || undefined,
      client_reference_id: sku || undefined,
      metadata: Object.keys(meta).length ? meta : undefined,
    });

    // Redirect “alla Stripe”: 303 + Location (Netlify-friendly)
    return {
      statusCode: 303,
      headers: { Location: session.url },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('create-checkout-session error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

