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

    // 1. elenca tutto e verifica che la chiave esista davvero
    const list = await store.list();
    const keys = list.blobs.map((b) => b.key);
    const hasKey = keys.includes(email);

    if (!hasKey) {
      // non esiste proprio
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

    // 2. leggi in forma GREZZA
    const raw = await store.get(email);

    let obj = null;

    // se è già un oggetto (runtime ce lo dà così)
    if (typeof raw === 'object' && raw !== null) {
      obj = raw;
    } else if (typeof raw === 'string') {
      // prova a fare parse
      try {
        obj = JSON.parse(raw);
      } catch {
        obj = null;
      }
    }

    // se dopo tutto questo è ancora null, restituiamo default
    if (!obj) {
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

    // alcuni casi possono essere { ok:true, email:..., data:{...} }
    if (obj.data && typeof obj.data === 'object') {
      obj = obj.data;
    }

    const minutes = Number(obj.minutes || 0);
    const points  = Number(obj.points  || 0);
    const tier    = obj.tier || 'None';
    const history = Array.isArray(obj.history) ? obj.history : [];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes, points, tier, history }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
