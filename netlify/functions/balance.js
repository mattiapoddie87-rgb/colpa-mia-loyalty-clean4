// netlify/functions/balance.js
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

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

  // prendiamo siteId e token dalle env (tu le hai già)
  const siteId = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteId || !token) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error:
          'Mancano NETLIFY_SITE_ID o NETLIFY_BLOBS_TOKEN nelle variabili di ambiente',
      }),
    };
  }

  try {
    // qui forziamo la config manuale
    const store = getStore({
      name: 'wallet',
      siteId,
      token,
    });

    const raw = await store.get(email, { type: 'json' });

    const data = raw || {
      minutes: 0,
      points: 0,
      tier: 'None',
      history: [],
    };

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
