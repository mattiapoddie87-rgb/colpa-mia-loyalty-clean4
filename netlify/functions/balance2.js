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

  const store = getStore({
    name: 'wallet',
    siteID: SITE_ID,
    token: BLOB_TOKEN,
  });

  // elenco chiavi per essere sicuri di leggere lo stesso store
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
        note: 'not found',
      }),
    };
  }

  // leggo grezzo
  const raw = await store.get(email);

  let obj = raw;

  // se è stringa provo a fare parse
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      obj = null;
    }
  }

  // se è del tipo { ok:true, data:{...} } prendo data
  if (obj && typeof obj === 'object' && obj.data && typeof obj.data === 'object') {
    obj = obj.data;
  }

  // se ancora niente: default
  if (!obj || typeof obj !== 'object') {
    obj = { minutes: 0, points: 0, tier: 'None', history: [] };
  }

  const out = {
    minutes: Number(obj.minutes || 0),
    points: Number(obj.points || 0),
    tier: obj.tier || 'None',
    history: Array.isArray(obj.history) ? obj.history : [],
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(out),
  };
};
