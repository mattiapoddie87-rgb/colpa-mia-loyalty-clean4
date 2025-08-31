// netlify/functions/create-checkout-session.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const SITE_URL = process.env.SITE_URL || 'http://localhost:8888';

// Mappa SKU → minuti (coerente con il frontend)
const SKU_MINUTES = {
  SCUSA_BASE: 10,
  SCUSA_TRIPLA: 30,
  SCUSA_DELUXE: 60,
  RIUNIONE: 20,
  TRAFFICO: 20,
  CONN_KO: 20,
};

// Recupera price attivo per SKU (usa metadata.sku su prodotto oppure name)
async function getPriceForSKU(sku) {
  // 1) prova via search su prices by active
  const prices = await stripe.prices.search({
    query: `active:'true' AND metadata['sku']:'${sku}'`,
    limit: 1,
  });
  if (prices.data.length) return prices.data[0];

  // 2) fallback: cerca per prodotto con metadata.sku e poi ultimo price attivo
  const products = await stripe.products.search({
    query: `active:'true' AND metadata['sku']:'${sku}'`,
    limit: 1,
  });
  if (!products.data.length) throw new Error(`Nessun product per SKU ${sku}`);
  const product = products.data[0];
  const p = await stripe.prices.list({ product: product.id, active: true, limit: 1 });
  if (!p.data.length) throw new Error(`Nessun price attivo per SKU ${sku}`);
  return p.data[0];
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { sku, customer_email } = JSON.parse(event.body || '{}');
    if (!sku) throw new Error('SKU mancante');

    const price = await getPriceForSKU(sku);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity: 1 }],
      // se già conosci l'email la puoi passare (non obbligatorio)
      customer_email: customer_email || undefined,
      client_reference_id: sku,
      success_url: `${SITE_URL}/success.html?sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/cancel.html`,
      metadata: {
        sku,
        minutes: SKU_MINUTES[sku] || 0,
      },
    });

    // Netlify proxy segue 303 → redirect
    return {
      statusCode: 303,
      headers: { Location: session.url },
      body: '',
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) };
  }
}
