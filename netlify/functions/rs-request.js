const { createClient } = require('@netlify/blobs');
const crypto = require('crypto');

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // Health check: GET /.netlify/functions/rs-request?health=1
  if (event.httpMethod === 'GET' && (event.queryStringParameters?.health === '1')) {
    return json(200, {
      ok: true,
      siteId: !!process.env.NETLIFY_SITE_ID,
      token: !!process.env.NETLIFY_BLOBS_TOKEN,
      node: process.version,
    });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  // --- ENV check (principale causa di 500) ---
  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteId || !token) {
    return json(500, {
      ok: false,
      error: 'env_missing',
      hint: 'NETLIFY_SITE_ID e/o NETLIFY_BLOBS_TOKEN non presenti.',
    });
  }

  // --- Parse input ---
  let input = {};
  try { input = JSON.parse(event.body || '{}'); } catch (e) {
    return json(400, { ok:false, error:'bad_json', detail: e.message });
  }

  const email   = String(input.email || '').trim();
  const context = String(input.context || '').trim();
  const brief   = String(input.brief || '').trim();
  const proof   = input.proof === 'no' ? 'no' : 'yes';
  const ttlOpt  = String(input.ttl || '').trim(); // 'none' | '24h' | '7d' | '30d'

  if (!email || !context) {
    return json(400, { ok:false, error:'validation_failed', hint:'email e context sono obbligatori' });
  }

  // TTL opzionale
  let expiresAt = null;
  const now = Date.now();
  const add = ms => new Date(now + ms).toISOString();
  if (ttlOpt === '24h')  expiresAt = add(24 * 3600e3);
  if (ttlOpt === '7d')   expiresAt = add(7  * 24 * 3600e3);
  if (ttlOpt === '30d')  expiresAt = add(30 * 24 * 3600e3);

  try {
    const client = createClient({ siteId, token });
    const store  = client.store('responsibility-switch'); // auto-create

    const id = crypto.randomUUID();
    const record = {
      id,
      createdAt: new Date().toISOString(),
      email, context, brief, proof,
      status: 'draft',
      expiresAt,          // null o ISO
    };

    await store.setJSON(`requests/${id}.json`, record);

    const base =
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      process.env.SITE_URL || '';

    const origin = base && !/^https?:\/\//i.test(base) ? `https://${base}` : base;
    const link = origin ? `${origin}/switch/${id}` : `/switch/${id}`;

    return json(200, { ok:true, id, link });
  } catch (e) {
    // Log nei function logs; messaggio esplicito al client
    console.error('rs-request error:', e);
    return json(500, { ok:false, error:'server_error', detail: e.message || String(e) });
  }
};
