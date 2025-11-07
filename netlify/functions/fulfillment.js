// netlify/functions/fulfillment.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

const PRICE_BY_SKU = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
const PRICE_RULES  = JSON.parse(process.env.PRICE_RULES_JSON  || '{}');

const SITE_ID  = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

// stesso nome che usa balance.js
const STORE_NAME = 'wallet';

function minutesFor(sku, metadata = {}) {
  if (PRICE_RULES[sku] && PRICE_RULES[sku].minutes) {
    return PRICE_RULES[sku].minutes;
  }
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
  } catch (e) {
    // se non esiste o non è json
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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'method_not_allowed' };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, body: 'STRIPE_SECRET_KEY missing' };
  }
  if (!SITE_ID || !BLOB_TOKEN) {
    return { statusCode: 500, body: 'NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN missing' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const sessionId = body.sessionId;
    if (!sessionId) {
      return { statusCode: 400, body: 'sessionId missing' };
    }

    // 1. prendo la sessione stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer'],
    });

    const email =
      session.customer_details?.email ||
      session.customer_email;
    if (!email) {
      return { statusCode: 400, body: 'email missing on session' };
    }

    const metadata = session.metadata || {};

    // 2. ricavo lo SKU
    let sku = metadata.sku;
    if (!sku) {
      const lineItem = session.line_items?.data?.[0];
      const priceId  = lineItem?.price?.id;
      if (priceId) {
        sku = Object.keys(PRICE_BY_SKU).find(
          (key) => PRICE_BY_SKU[key] === priceId
        );
      }
    }

    // se ancora niente, accredito 0 ma rispondo ok
    const minutes = sku ? minutesFor(sku, metadata) : 0;

    // 3. apro lo store
    const store = getStore({
      name: STORE_NAME,
      siteID: SITE_ID,
      token: BLOB_TOKEN,
    });

    // 4. leggo il wallet
    const wallet = await loadWallet(store, email);

    // 5. aggiorno
    if (minutes > 0) {
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

      // 6. salvo
      await store.set(email, wallet, { type: 'json' });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        credited: minutes,
        sku: sku || null,
      }),
    };
  } catch (err) {
    console.error('fulfillment error', err);
    return { statusCode: 500, body: err.message };
  }
};
