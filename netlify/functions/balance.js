const { getStore } = require('@netlify/blobs');
const { getWallet, creditMinutes } = require('./_wallet-lib'); // getWallet lo usiamo, creditMinutes se vuoi forzare test

const SITE_ID = process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

exports.handler = async (event) => {
  const method = event.httpMethod;
  let email = '';

  if (method === 'GET') {
    email = event.queryStringParameters?.email;
  } else if (method === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      email = body.email;
    } catch (_) {}
  } else {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email_missing' }) };
  }

  try {
    // prova a leggere il wallet normalmente
    const wallet = await getWallet(email);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        minutes: wallet.minutes || 0,
        points: wallet.points || 0,
        tier: wallet.tier || 'None',
        history: wallet.history || [],
      }),
    };
  } catch (err) {
    // qui entriamo quando c'è proprio l'errore "not valid JSON"
    // lo resettiamo
    const store = getStore({
      name: 'wallet',
      siteID: SITE_ID,
      token: BLOBS_TOKEN,
    });
    const empty = {
      email,
      minutes: 0,
      lastUpdated: new Date().toISOString(),
    };
    await store.set(email, empty, { type: 'json' });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        minutes: 0,
        points: 0,
        tier: 'None',
        history: [],
        reset: true,
      }),
    };
  }
};
