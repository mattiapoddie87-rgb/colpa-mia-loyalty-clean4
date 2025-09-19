// netlify/functions/rs-request.js
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
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  // --- ENV check (la causa più frequente dei 500) ---
  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteId || !token) {
    return json(500, {
      ok: false,
      error: 'env_missing',
      hint: 'Imposta NETLIFY_SITE_ID e NETLIFY_BLOBS_TOKEN nelle Environment variables del sito.',
    });
  }

  // --- Parse input ---
  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch {}
  const email   = String(payload.email || '').trim();
  const context = String(payload.context || '').trim();
  const brief   = String(payload.brief || '').trim();
  const proof   = payload.proof === 'no' ? 'no' : 'yes';
  const ttlOpt  = String(payload.ttl || '').trim(); // 'none' | '24h' | '7d' ...

  if (!email || !context) {
    return json(400, { ok: false, error: 'validation_failed', hint: 'email e context sono obbligatori' });
  }

  // --- TTL calcolato (facoltativo) ---
  let expiresAt = null;
  const now = Date.now();
  const add = (ms) => new Date(now + ms).toISOString();
  if (ttlOpt === '24h')  expiresAt = add(24 * 3600e3);
  if (ttlOpt === '7d')   expiresAt = add(7  * 24 * 3600e3);
  if (ttlOpt === '30d')  expiresAt = add(30 * 24 * 3600e3);

  try {
    // --- Blobs client + store ---
    const client = createClient({ siteId, token });
    const store  = client.store('responsibility-switch'); // nome della store

    // --- ID + record ---
    const id = crypto.randomUUID();
    const record = {
      id,
      createdAt: new Date().toISOString(),
      email,
      context,
      brief,
      proof,         // yes/no
      status: 'draft',
      expiresAt,     // null oppure ISO
    };

    // salva come JSON
    await store.setJSON(`requests/${id}.json`, record);

    // URL pubblico del sito
    const base =
      process.env.URL ||
      (process.env.DEPLOY_PRIME_URL ? `https://${process.env.DEPLOY_PRIME_URL}` : null) ||
      process.env.SITE_URL ||
      '';

    const link = base ? `${base}/switch/${id}` : `/switch/${id}`;

    return json(200, { ok: true, id, link });
  } catch (e) {
    // log utile nei Function logs, risposta “pulita” al client
    console.error('rs-request error:', e);
    return json(500, { ok: false, error: 'server_error', detail: e.message || String(e) });
  }
};
