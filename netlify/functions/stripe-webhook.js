// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

const PRICE_BY_SKU = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
const PRICE_RULES  = JSON.parse(process.env.PRICE_RULES_JSON  || '{}');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;
const STORE_NAME = 'wallet';

function minutesFor(sku, metadata = {}) {
  if (PRICE_RULES[sku] && PRICE_RULES[sku].minutes) return PRICE_RULES[sku].minutes;
  if (metadata.minutes) {
    const m = parseInt(metadata.minutes, 10);
    if (!isNaN(m) && m > 0) return m;
  }
  return 0;
}

async function loadWallet(store, email) {
  try {
    const data = await store.get(email, { type: 'json' });
    return data || {
      email,
      minutes: 0,
      points: 0,
      tier: 'None',
      history: [],
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    return {
      email,
      minutes: 0,
      points: 0,
      tier: 'None',
      history: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

exports.handler = async (event) => {
  // 1. controlli base
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!endpointSecret) {
    console.error('STRIPE_WEBHOOK_SECRET mancante');
    return { statusCode: 500, body: 'webhook secret missing' };
  }
  if (!SITE_ID || !BLOB_TOKEN) {
    console.error('NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN mancanti');
    return { statusCode: 500, body: 'blobs config missing' };
  }

  const sig = event.headers['stripe-signature'];
  // Stripe può inviare base64 -> lo normalizziamo
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('verifica firma webhook fallita:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // 2. gestiamo SOLO la chiusura del checkout
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const metadata = session.metadata || {};

    const email =
      session.customer_details?.email ||
      session.customer_email;
    if (!email) {
      console.log('nessuna email in sessione, stop');
      return { statusCode: 200, body: 'no email' };
    }

    // prendo lo sku che tu metti già nei metadata
    let sku = metadata.sku;

    // se manca, recupero i line items
    if (!sku) {
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items'],
      });
      const li = fullSession.line_items?.data?.[0];
      const priceId = li?.price?.id;
      if (priceId) {
        sku = Object.keys(PRICE_BY_SKU).find(k => PRICE_BY_SKU[k] === priceId);
      }
    }

    const minutes = sku ? minutesFor(sku, metadata) : 0;
    console.log('webhook -> email:', email, 'sku:', sku, 'minutes:', minutes);

    if (minutes > 0) {
      const store = getStore({
        name: STORE_NAME,
        siteID: SITE_ID,
        token: BLOB_TOKEN,
      });

      const wallet = await loadWallet(store, email);
      wallet.minutes = (wallet.minutes || 0) + minutes;
      wallet.history = wallet.history || [];
      wallet.history.unshift({
        id: session.id,
        created: Math.floor(Date.now() / 1000),
        amount: session.amount_total || 0,
        currency: session.currency || 'eur',
        minutes,
        sku: sku || null,
      });
      wallet.lastUpdated = new Date().toISOString();

      await store.set(email, wallet, { type: 'json' });
      console.log('wallet aggiornato per', email);
    } else {
      console.log('nessun minuto da accreditare per questo SKU');
    }
  }

  return { statusCode: 200, body: 'ok' };
};
