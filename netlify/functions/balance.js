// netlify/functions/balance.js
const { getStore } = require('@netlify/blobs');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;
const STORE_NAME = 'wallet';

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
      name: STORE_NAME,
      siteID: SITE_ID,
      token: BLOB_TOKEN,
    });

    // 1) prova a leggerlo come JSON (caso nuovo)
    let data = await store.get(email, { type: 'json' }).catch(() => null);

    // 2) se era stato salvato male, arriva stringa tipo "[object Object]"
    if (!data) {
      const raw = await store.get(email).catch(() => null);
      if (raw && typeof raw === 'string') {
        // non è JSON valido, quindi restituiamo default
        data = null;
      }
    }

    // struttura di default
    const base = {
      minutes: 0,
      points: 0,
      tier: 'None',
      history: [],
    };

    // se non c'è niente, restituisco default senza reset
    if (!data) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base),
      };
    }

    // normalizza quello che c'è
    const out = {
      minutes: Number(data.minutes || 0),
      points: Number(data.points || 0),
      tier: data.tier || 'None',
      history: Array.isArray(data.history) ? data.history : [],
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
