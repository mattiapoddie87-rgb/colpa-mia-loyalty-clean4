// netlify/functions/wallet-debug.js
const { getStore } = require('@netlify/blobs');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;
const STORE_NAME = 'wallet';

exports.handler = async (event) => {
  try {
    const store = getStore({
      name: STORE_NAME,
      siteID: SITE_ID,
      token: BLOB_TOKEN,
    });

    const email = event.queryStringParameters?.email;

    // se passo ?email=... mostro il contenuto grezzo
    if (email) {
      const val = await store.get(email); // <-- nessun {type:'json'}
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: String(val),
      };
    }

    // altrimenti lista le chiavi
    const list = await store.list();
    const keys = list.blobs.map((b) => b.key);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: err.message,
    };
  }
};
