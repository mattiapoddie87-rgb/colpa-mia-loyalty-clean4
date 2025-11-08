// netlify/functions/balance2.js
// RESTITUISCE saldo minuti/punti leggendo dal blob "wallet"

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

// IMPORTANTISSIMO: usa la chiave siteID (D maiuscola)
const SITE_ID = process.env.NETLIFY_SITE_ID || 'INSERISCI_SITE_ID_NETLIFY';
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN || 'INSERISCI_NETLIFY_BLOBS_TOKEN';

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

  try {
    const store = getStore({
      name: 'wallet',
      siteID: SITE_ID,          // ← QUI la D maiuscola
      token: BLOB_TOKEN,
    });

    const data = await store.get(email, { type: 'json' });

    const payload = data
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
      body: JSON.stringify(payload),
    };
  } catch (err) {
    // così vedi in risposta ESATTAMENTE cosa non gli piace
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
