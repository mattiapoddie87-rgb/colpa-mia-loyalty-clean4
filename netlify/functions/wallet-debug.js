// netlify/functions/wallet-debug.js
const { getStore } = require('@netlify/blobs');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;
const STORE_NAME = 'wallet';

exports.handler = async (event) => {
  try {
    if (!SITE_ID || !BLOB_TOKEN) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN missing' }),
      };
    }

    const store = getStore({
      name: STORE_NAME,
      siteID: SITE_ID,
      token: BLOB_TOKEN,
    });

    const email = event.queryStringParameters?.email;

    // se passo ?email=... mostro quel record
    if (email) {
      const val = await store.get(email, { type: 'json' });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          {
            key: email,
            value: val ?? null,
          },
          null,
          2
        ),
      };
    }

    // altrimenti lista delle chiavi
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
