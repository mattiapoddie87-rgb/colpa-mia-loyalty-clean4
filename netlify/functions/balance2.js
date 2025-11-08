// netlify/functions/balance2.js
// legge il saldo minuti dal blob "wallet"

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

const SITE_ID = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'email mancante' }),
    };
  }

  // qui c’era l’errore: se non passi siteID e token, Netlify mostra esattamente
  // il messaggio che vedi tu.
  if (!SITE_ID || !BLOB_TOKEN) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: 'NETLIFY_SITE_ID o NETLIFY_BLOBS_TOKEN mancanti nel deploy',
      }),
    };
  }

  try {
    const store = getStore({
      name: 'wallet',
      siteID: SITE_ID,   // <- D maiuscola
      token: BLOB_TOKEN,
    });

    const data = await store.get(email, { type: 'json' });

    const out = data
      ? {
          minutes: Number(data.minutes || 0),
          points: Number(data.points || 0),
          tier: data.tier || 'None',
          history: Array.isArray(data.history) ? data.history : [],
        }
      : { minutes: 0, points: 0, tier: 'None', history: [] };

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
