// netlify/functions/rs-request.js
const { randomUUID } = require('crypto');

/* ----------------------------- helpers ---------------------------------- */

function getBaseUrl(event) {
  // URL del sito (prod/preview/local)
  const host = event?.headers?.host;
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (host ? `https://${host}` : '')
  );
}

// Salva su Netlify Blobs con chiave *links/<id>.json*
async function saveToBlobs(id, data) {
  try {
    const { getStore } = require('@netlify/blobs');

    // Inizializzazione esplicita per evitare "environment not configured"
    const store = getStore({
      name: 'rs',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });

    const key = `links/${id}.json`;
    await store.setJSON(key, data, { metadata: { createdAt: Date.now() } });
    return { ok: true, key };
  } catch (e) {
    console.error('blobs_set_failed', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// Invio email con Resend (semplice e robusto)
async function sendEmail({ to, subject, text, html }) {
  const FROM =
    process.env.RS_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    process.env.FROM_EMAIL ||
    '';

  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!to) return { ok: false, error: 'missing_to' };
  if (!FROM) return { ok: false, error: 'missing_from' };
  if (!RESEND_KEY) return { ok: false, error: 'missing_resend_key' };

  const { Resend } = require('resend');
  const resend = new Resend(RESEND_KEY);

  await resend.emails.send({
    from: FROM,
    to: Array.isArray(to) ? to : [to], // Resend accetta array
    subject,
    text,
    html,
  });

  return { ok: true };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ------------------------------ handler --------------------------------- */

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // campi dal form
    const email   = String(body.email || '').trim();
    const context = String(body.context || '').trim();
    const note    = String(body.note || '').trim();
    const ttl     = String(body.ttl || body.expires || 'none').trim(); // compat
    const proof   = String(body.proof || 'yes').trim();                // 'yes'|'no'
    const manleva = !!body.manleva;

    if (!manleva) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'manleva_required' }),
      };
    }

    const id = randomUUID();

    // URL pubblico del link (passo anche il contesto per UX)
    const baseUrl   = getBaseUrl(event);
    const publicUrl = `${baseUrl}/rs/${id}?ctx=${encodeURIComponent(context)}`;

    // calcolo eventuale scadenza
    let expiresAt = null;
    if (ttl === '24h') {
      expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    } else if (ttl === '7d') {
      expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    }

    const record = {
      id,
      email,
      context,
      note,
      ttl,
      proof,         // 'yes' | 'no'
      url: publicUrl,
      createdAt: Date.now(),
      expiresAt,     // ms epoch o null
      status: 'NEW',
    };

    // Salvataggio
    const saveRes = await saveToBlobs(id, record);
    if (!saveRes.ok) {
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'blobs_save_failed',
          detail: saveRes.error,
        }),
      };
    }

    // Email di conferma (solo se richiesto e presente email)
    let mail = { ok: false, skipped: true };
    if (proof !== 'no' && email) {
      const subject = 'COLPA MIA — Il tuo Responsibility Switch';
      const text = `Ecco il tuo link personale:\n${publicUrl}\n\nTienilo e inoltralo al destinatario.`;
      const html = `
        <p>Ecco il tuo link personale:</p>
        <p><a href="${publicUrl}">${publicUrl}</a></p>
        <p>Tienilo e inoltralo al destinatario.</p>
      `;
      try {
        mail = await sendEmail({ to: email, subject, text, html });
      } catch (e) {
        console.error('email_failed', e?.message || e);
        mail = { ok: false, error: e?.message || String(e) };
      }
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        id,
        url: publicUrl,
        saved: true,
        email: mail,
      }),
    };
  } catch (e) {
    console.error('rs-request_error', e?.message || e);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
    };
  }
};
