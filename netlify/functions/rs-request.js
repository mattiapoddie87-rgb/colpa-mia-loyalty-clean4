// netlify/functions/rs-request.js
// Crea un link "Responsibility Switch" e salva i dati su Netlify Blobs

const { randomUUID } = require('crypto');
const { createClient } = require('@netlify/blobs');

function getBlobsClient() {
  // Usa SiteID/Token da ENV (UI Netlify → Environment variables)
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteID || !token) {
    throw new Error('Missing NETLIFY_SITE_ID or NETLIFY_BLOBS_TOKEN');
  }
  return createClient({ siteID, token });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, context, note, proof = 'Si', expire = 'none' } =
      JSON.parse(event.body || '{}');

    if (!email || !context) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'missing_fields' }) };
    }

    // genera id univoco
    const id = randomUUID();

    const payload = {
      id,
      email,
      context,
      note: note || '',
      proof: String(proof || 'Si'),
      expire,                       // 'none' | '24h' | '7d' | iso date
      createdAt: new Date().toISOString(),
      status: 'created'
    };

    // salva su Blobs (store: rswitch)
    const blobs = getBlobsClient();
    const store = blobs.store('rswitch');       // crea se non esiste
    await store.setJSON(`req/${id}.json`, payload);

    // link pubblico (puoi puntare a una tua pagina /rs/:id se la implementi)
    const origin = process.env.URL || `https://${event.headers.host}`;
    const link = `${origin}/responsibility-switch.html?rid=${encodeURIComponent(id)}`;

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, id, link })
    };
  } catch (err) {
    console.error('rs-request error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server_error' }) };
  }
};
