// netlify/functions/rs-get.js
const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const ok = (b) => ({ statusCode: 200, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify(b) });
const bad = (s, m) => ({ statusCode: s, headers: { 'content-type': 'application/json', ...CORS }, body: JSON.stringify({ error: m }) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'GET') return bad(405, 'Method Not Allowed');

  const id = event.queryStringParameters?.id;
  if (!id) return bad(400, 'missing_id');

  let store;
  try {
    store = getStore({
      name: 'rs',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });
  } catch (e) {
    console.error('blobs_init_failed', e?.message || e);
    return bad(500, 'blobs_init_failed');
  }

  try {
    const key = `links/${id}.json`;
    const data = await store.get(key, { type: 'json' }); // ritorna null se non esiste o è scaduto
    if (!data) return bad(404, 'not_found');
    return ok(data);
  } catch (e) {
    console.error('blobs_get_failed', e?.message || e);
    return bad(500, 'blobs_get_failed');
  }
};
