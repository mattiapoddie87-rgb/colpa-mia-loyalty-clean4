// netlify/functions/rs-request.js
// Responsability Switch – crea una richiesta e la salva su Netlify Blobs

// NOTA: @netlify/blobs è ESM. In CommonJS lo importiamo con un import dinamico.
async function getBlobsStore() {
  const { createClient } = await import('@netlify/blobs');
  const client = createClient({
    token: process.env.NETLIFY_BLOBS_TOKEN,
    siteID: process.env.NETLIFY_SITE_ID,
  });
  // Nome store configurabile via env; default: "rs-requests"
  const storeName = process.env.BLOB_STORE_RS || 'rs-requests';
  return client.getStore(storeName);
}

// utils -------------------------------------------------------------
function ok(body, status = 200, headers = {}) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST,OPTIONS,GET',
      'access-control-allow-headers': 'content-type',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function bad(msg, status = 400) {
  return ok({ error: msg }, status);
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function baseUrl(event) {
  // prova a ricostruire l’origin (Netlify mette X-Forwarded-Proto/Host)
  const proto =
    event.headers['x-forwarded-proto'] ||
    event.headers['x-forwarded-protocol'] ||
    'https';
  const host = event.headers['x-forwarded-host'] || event.headers.host || '';
  return `${proto}://${host}`;
}

// handler -----------------------------------------------------------
exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return ok('', 204);
    }

    // Health check rapido
    if (event.httpMethod === 'GET' && event.queryStringParameters?.health) {
      return ok({ ok: true, name: 'rs-request' });
    }

    if (event.httpMethod !== 'POST') {
      return bad('Method Not Allowed', 405);
    }

    // parse body
    let data = {};
    try {
      data = JSON.parse(event.body || '{}');
    } catch (_) {
      return bad('Invalid JSON');
    }

    // campi attesi dal form
    const email = String(data.email || '').trim();
    const context = String(data.context || '').trim(); // es: LAVORO/CENA/...
    const note = String(data.note || '').trim();       // opzionale
    const proof = String(data.proof || 'yes');         // "yes" | "no"
    const ttl = String(data.ttl || 'none');            // "none" | "24h" | "7d"
    const manleva = !!data.manleva;

    if (!isEmail(email)) return bad('Email non valida');
    if (!context) return bad('Contesto mancante');
    if (!manleva) return bad('Manleva non confermata');

    // TTL in secondi (se vuoi far scadere il link)
    let expiresAt = null;
    if (ttl === '24h') {
      expiresAt = Date.now() + 24 * 3600 * 1000;
    } else if (ttl === '7d') {
      expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
    }

    // record da salvare
    const id = `rs_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const record = {
      id,
      email,
      context,
      note,
      proof: proof === 'yes',
      expiresAt,             // timestamp o null
      createdAt: Date.now(),
      status: 'created',     // created | sent | opened | chosen | expired
      choices: [
        'Riprogramma',
        'Voucher',
        'Richiamami'
      ],                     // puoi personalizzare/parametrizzare
      meta: {},
    };

    // Salva su Netlify Blobs
    const store = await getBlobsStore();
    await store.setJSON(id, record);

    // URL pubblico della pagina switch (crea la pagina se non l’hai già)
    // Es: /switch.html?id=xxxxx  oppure un path “pretty” se hai una route dedicata.
    const publicUrl = `${baseUrl(event)}/responsibility-switch.html?id=${encodeURIComponent(id)}`;

    // (Opzionale) invio email al richiedente con il link – qui lasciamo solo come placeholder:
    // await sendMailWithResend({ to: email, url: publicUrl, context });

    return ok({
      ok: true,
      id,
      url: publicUrl,
      expiresAt,
    });
  } catch (err) {
    console.error('rs-request error:', err);
    // errore generico
    return bad('server_error', 500);
  }
};
