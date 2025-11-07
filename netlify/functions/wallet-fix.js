// netlify/functions/wallet-fix.js
const { getStore } = require('@netlify/blobs');

const SITE_ID    = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;
const STORE_NAME = 'wallet';

// chiamala così:
// /.netlify/functions/wallet-fix?email=...&minutes=10
exports.handler = async (event) => {
  const email   = event.queryStringParameters?.email;
  const minutes = Number(event.queryStringParameters?.minutes || 0);

  if (!email) {
    return { statusCode: 400, body: 'email required' };
  }
  if (!SITE_ID || !BLOB_TOKEN) {
    return { statusCode: 500, body: 'blobs not configured' };
  }

  const store = getStore({
    name: STORE_NAME,
    siteID: SITE_ID,
    token: BLOB_TOKEN,
  });

  // oggetto pulito
  const data = {
    minutes: minutes,
    points: 0,
    tier: 'None',
    history: [],
  };

  await store.set(email, data, { type: 'json' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, email, data }, null, 2),
  };
};
