// netlify/functions/wallet-check.js
const { getStore } = require('@netlify/blobs');
const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN   = process.env.NETLIFY_BLOBS_TOKEN;

exports.handler = async () => {
  const store = getStore({ name: 'wallet', siteID: SITE_ID, token: TOKEN });
  const list = await store.list();
  const keys = list.blobs.map(b => b.key);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: keys.length, keys }, null, 2)
  };
};
