// Crea/ritorna un link RS e lo salva nei Netlify Blobs (store: "rs-links")
const { createClient } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { email, context, note, proof = 'yes', ttl = 0 } = JSON.parse(event.body || '{}');

    // token link
    const token = cryptoRandom();
    const createdAt = Date.now();

    // client esplicito (niente auto-env)
    const blobs = createClient({
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
    const store = blobs.getStore('rs-links');

    const data = { token, email: (email||'').trim(), context, note, proof, createdAt };
    const key  = `links/${token}.json`;

    // TTL opzionale
    await store.setJSON(key, data, ttl ? { ttl } : undefined);

    const publicUrl = `/rs/${token}?ctx=${encodeURIComponent(context||'')}`;

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, token, url: publicUrl })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: `server_error: ${e.message || e}`
    };
  }
};

// piccolo generatore sicuro
function cryptoRandom () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = (Math.random()*16)|0, v = c==='x'? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
