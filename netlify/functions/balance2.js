// netlify/functions/balance2.js
const { getStore } = require('@netlify/blobs');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

exports.handler = async (event) => {
  const email = event.queryStringParameters?.email;
  if (!email) {
    return resp(400, { error: 'email required' });
  }

  try {
    const store = getStore({
      name: 'wallet',
      siteID: SITE_ID,
      token: BLOB_TOKEN,
    });

    // 1. controllo che la chiave esista
    const list = await store.list();
    const keys = list.blobs.map(b => b.key);
    if (!keys.includes(email)) {
      return resp(200, emptyWallet());
    }

    // 2. provo PRIMA come JSON
    let data = null;
    try {
      data = await store.get(email, { type: 'json' });
    } catch (_) {
      data = null;
    }

    // 3. se non è andata, lo leggo grezzo
    if (!data) {
      const raw = await store.get(email);
      if (typeof raw === 'string') {
        // se è una stringa vera, provo a fare il parse
        try {
          data = JSON.parse(raw);
        } catch (_) {
          // caso sporco: era proprio "[object Object]"
          data = null;
        }
      } else if (raw && typeof raw === 'object') {
        // in alcuni runtimes può già essere oggetto
        data = raw;
      }
    }

    // 4. se è nel formato { ok:true, data:{...} } lo normalizzo
    if (data && typeof data === 'object' && data.data && typeof data.data === 'object') {
      data = data.data;
    }

    // 5. se ancora non ho un oggetto valido, restituisco zero
    if (!data || typeof data !== 'object') {
      return resp(200, emptyWallet());
    }

    const out = {
      minutes: Number(data.minutes || 0),
      points: Number(data.points || 0),
      tier: data.tier || 'None',
      history: Array.isArray(data.history) ? data.history : [],
    };

    return resp(200, out);
  } catch (err) {
    return resp(500, { error: err.message || String(err) });
  }
};

// helper
function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function emptyWallet() {
  return { minutes: 0, points: 0, tier: 'None', history: [] };
}
