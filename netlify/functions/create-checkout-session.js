// netlify/functions/create-checkout-session.js
// Crea la Checkout Session: riusa Customer, precompila email, raccoglie segnali di contesto per la scusa.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

    let body = {};
    if (event.httpMethod === 'POST') {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else if (event.httpMethod === 'GET') {
      const q = new URLSearchParams(event.queryStringParameters || {});
      body = { email: q.get('email'), priceId: q.get('priceId'), sku: q.get('sku'), qty: q.get('qty') };
    } else {
      return resp(405, { error: 'Method Not Allowed' });
    }

    const email    = String(body.email || '').trim().toLowerCase();
    const priceId  = String(body.priceId || '').trim();
    const sku      = String(body.sku || '').trim();
    const quantity = Math.max(1, parseInt(body.qty || '1', 10));

    // 1) Risolvi il price
    let price = null;
    if (priceId) {
      price = await stripe.prices.retrieve(priceId);
      if (!price.active) throw new Error('Price non attivo');
    }
    if (!price && sku) {
      const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] });
      price = prices.data.find(p =>
        (p.metadata && p.metadata.sku === sku) ||
        (p.product && p.product.metadata && p.product.metadata.sku === sku)
      ) || null;
    }
    if (!price) return resp(400, { error: 'Price non trovato (passa priceId o sku valido)' });

    // 2) Riuso Customer se esiste
    let existingCustomer = null;
    if (email) {
      try {
        const r = await stripe.customers.search({ query: `email:"${email}"`, limit: 1 });
        existingCustomer = r.data[0] || null;
      } catch {
        const r2 = await stripe.customers.list({ email, limit: 1 });
        existingCustomer = r2.data[0] || null;
      }
    }

    // 3) Crea Session con campi di contesto (tutti facoltativi)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity }],
      success_url: 'https://colpamia.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://colpamia.com/cancel',
      ...(existingCustomer
        ? { customer: existingCustomer.id }
        : { customer_email: email || undefined, customer_creation: 'always' }
      ),
      custom_fields: [
        { key: 'need',      label: { type: 'custom', custom: 'Esigenza sintetica (facoltativa)' }, type: 'text', optional: true },
        { key: 'recipient', label: { type: 'custom', custom: 'Nome destinatario (facoltativo)' },  type: 'text', optional: true },
        { key: 'tone',      label: { type: 'custom', custom: 'Tono (formale/informale)' },         type: 'text', optional: true },
        { key: 'delay',     label: { type: 'custom', custom: 'Ritardo previsto (minuti)' },        type: 'text', optional: true }
      ],
      phone_number_collection: { enabled: true },
      allow_promotion_codes: true
    });

    return resp(200, { url: session.url, id: session.id });
  } catch (err) {
    return resp(500, { error: err.message || 'Errore interno' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
