// netlify/functions/balance.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

// prendiamo lo store "wallet" dai blobs
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
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
    // nome dello store: "wallet"
    const store = getStore('wallet');

    // la key che abbiamo usato nel webhook è proprio l’email
    const raw = await store.get(email, { type: 'json' });

    // se non esiste ancora, restituiamo 0
    const data = raw || { minutes: 0, points: 0, tier: 'None', history: [] };

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        minutes: data.minutes || 0,
        points: data.points || 0,
        tier: data.tier || 'None',
        history: Array.isArray(data.history) ? data.history : [],
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message || 'internal error' }),
    };
  }
};
