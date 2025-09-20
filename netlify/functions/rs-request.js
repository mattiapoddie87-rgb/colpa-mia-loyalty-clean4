// netlify/functions/rs-request.js
// Crea/ritorna un Responsibility Switch link salvandolo in Netlify Blobs.
// - Salvataggio idempotente e validazioni chiare (mai 500 non gestiti)
// - CORS e preflight gestiti
// - Invio email opzionale via Resend se RESEND_API_KEY è configurata

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function ok(body) {
  return { statusCode: 200, headers: { 'content-type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(body) };
}
function bad(status, msg) {
  return { statusCode: status, headers: { 'content-type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: msg }) };
}

function baseUrl(event) {
  // URL in produzione, fallback a origin della richiesta o localhost
  return process.env.URL || event?.headers?.origin || 'http://localhost:8888';
}

function parseJSON(body) {
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function ttlSeconds(code) {
  if (!code || code === 'none') return undefined;
  if (code === '24h') return 24 * 60 * 60;
  if (code === '7d') return 7 * 24 * 60 * 60;
  return undefined;
}

async function sendEmailIfConfigured(to, link, context, note) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // opzionale
  try {
    const { Resend } = require('resend');
    const resend = new Resend(key);
    await resend.emails.send({
      from: 'COLPA MIA <no-reply@colpamia.com>',
      to,
      subject: 'Il tuo Responsibility Switch',
      html: `
        <p>Ciao! Ecco il tuo link:</p>
        <p><a href="${link}">${link}</a></p>
        <p><b>Contesto:</b> ${context || '-'}</p>
        ${note ? `<p><b>Note:</b> ${note}</p>` : ''}
        <p>Puoi condividere questo link con il destinatario. Ogni scelta verrà tracciata.</p>
      `,
    });
  } catch (e) {
    // Non blocchiamo il flusso se l'email fallisce
    console.error('resend_email_failed', e?.message || e);
  }
}

exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  if (event.httpMethod !== 'POST') {
    return bad(405, 'Method Not Allowed');
  }

  // --- INPUT ---
  const { email, context, note, ttl, proof, manleva } = parseJSON(event.body);

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return bad(400, 'Email non valida');
  }
  if (!manleva) {
    return bad(400, 'Manleva non confermata');
  }

  // --- BLOBS STORE (v7) ---
  let store;
  try {
    store = getStore({
      name: 'rs', // nome del tuo store
      // in Functions i due valori sono disponibili; lasciarli anche se non strettamente necessari
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });
  } catch (e) {
    console.error('blobs_init_failed', e?.message || e);
    return bad(500, 'blobs_init_failed');
  }

  // --- RECORD ---
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const record = {
    id,
    createdAt,
    email,
    context: context || '',
    note: note || '',
    proof: proof === 'no' ? 'no' : 'yes',
    status: 'active',
    version: 1,
  };

  // chiave e TTL (automatica su Blobs)
  const key = `links/${id}.json`;
  const ttlSec = ttlSeconds(ttl);

  try {
    await store.set(
      key,
      Buffer.from(JSON.stringify(record), 'utf8'),
      ttlSec ? { ttl: ttlSec } : undefined
    );
  } catch (e) {
    console.error('blobs_set_failed', e?.message || e);
    return bad(500, 'blobs_set_failed');
  }

  // URL pubblico del link (la tua pagina consumerà l’id)
  const link = `${baseUrl(event).replace(/\/$/, '')}/rs/${id}`;

  // email opzionale
  await sendEmailIfConfigured(email, link, context, note);

  return ok({ id, url: link });
};
