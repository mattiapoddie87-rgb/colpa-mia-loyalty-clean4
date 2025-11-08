// netlify/functions/balance2.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'email mancante' }),
    };
  }

  try {
    // deve essere LO STESSO nome usato nel webhook
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('colpamia-wallet');

    // blob per singola email
    const raw = await store.get(email);
    let data = {};

    if (raw) {
      // raw qui è già un object perché nel webhook hai fatto store.set(email, {...})
      data = raw;
    }

    // normalizzo i campi
    const out = {
      minutes: Number(data.minutes) || 0,
      points: Number(data.points) || 0,
      tier: data.tier || 'None',
      history: Array.isArray(data.history) ? data.history : [],
    };

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
