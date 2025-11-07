// netlify/functions/balance.js
const { getStore } = require('@netlify/blobs');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;
const STORE_NAME = 'wallet';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'method_not_allowed' }),
    };
  }

  const email = (event.queryStringParameters && event.queryStringParameters.email) || '';
  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'email_required' }),
    };
  }

  if (!SITE_ID || !BLOB_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'blobs_not_configured' }),
    };
  }

  const store = getStore({
    name: STORE_NAME,        // <<< stesso nome del webhook
    siteID: SITE_ID,
    token: BLOB_TOKEN,
  });

  let data = null;
  try {
    data = await store.get(email, { type: 'json' });
  } catch (e) {
    // se non c'è, data resta null
  }

  if (!data) {
    // risposta compatibile con il tuo wallet.html
    data = {
      minutes: 0,
      points: 0,
      tier: 'None',
      history: [],
      reset: true,
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data),
  };
};
