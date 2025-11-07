// netlify/functions/balance2.js
const { getStore } = require('@netlify/blobs');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

exports.handler = async (event) => {
  const email = event.queryStringParameters?.email;
  if (!email) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'email required' }),
    };
  }

  try {
    const store = getStore({
      name: 'wallet',
      siteID: SITE_ID,
      token: BLOB_TOKEN,
    });

    // 1. elenco chiavi solo per essere sicuri che lo store sia quello giusto
    const list = await store.list();
    const keys = list.blobs.map(b => b.key);
    if (!keys.includes(email)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minutes: 0,
          points: 0,
          tier: 'None',
          history: [],
        }),
      };
    }

    // 2. QUI la differenza: lo leggiamo come JSON, come ha fatto la funzione che ti mostrava i 10 minuti
    const json = await store.get(email, { type: 'json' });

    // se per qualche motivo è nullo
    if (!json) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minutes: 0,
          points: 0,
          tier: 'None',
          history: [],
        }),
      };
    }

    // caso che abbiamo visto: { ok:true, email:..., data:{...} }
    const payload = json.data && typeof json.data === 'object'
      ? json.data
      : json;

    const out = {
      minutes: Number(payload.minutes || 0),
      points: Number(payload.points || 0),
      tier: payload.tier || 'None',
      history: Array.isArray(payload.history) ? payload.history : [],
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
