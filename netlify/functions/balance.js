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
      body: JSON.stringify({ error: 'Metodo non consentito' }),
    };
  }

  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Email mancante' }),
    };
  }

  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteId || !token) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: 'Variabili NETLIFY_SITE_ID o NETLIFY_BLOBS_TOKEN mancanti',
      }),
    };
  }

  try {
    // inizializziamo lo store con siteId e token
    const store = getStore({
      name: 'wallet',
      siteId,
      token,
    });

    const data = await store.get(email, { type: 'json' });
    if (!data) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minutes: 0,
          points: 0,
          tier: 'None',
          history: [],
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minutes: Number(data.minutes || 0),
        points: Number(data.points || 0),
        tier: data.tier || 'None',
        history: Array.isArray(data.history) ? data.history : [],
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
