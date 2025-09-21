// netlify/functions/rs-request.js
const { randomUUID } = require('crypto');

// ---- Helpers ---------------------------------------------------------------

function getBaseUrl(event) {
  // URL del sito (prod/preview/local)
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    `https://${event.headers.host}`
  );
}

async function saveToBlobs(id, data) {
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('rs'); // namespace "rs"
    await store.setJSON(id, data, {
      metadata: { createdAt: Date.now() }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendEmail({ to, subject, text, html }) {
  // Mittente/chiavi retro-compatibili
  const FROM =
    process.env.RS_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    process.env.FROM_EMAIL ||
    '';

  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!to) return { ok: false, error: 'missing_to' };
  if (!FROM || !RESEND_KEY) return { ok: false, error: 'missing_provider' };

  const { Resend } = require('resend');
  const resend = new Resend(RESEND_KEY);

  await resend.emails.send({
    from: FROM,
    to: Array.isArray(to) ? to : [to], // SEMPRE array
    subject,
    text,
    html
  });

  return { ok: true };
}

// ---- Handler ---------------------------------------------------------------

exports.handler = async (event) => {
  // CORS/OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // campi attesi dal form
    const email = String(body.email || '').trim();        // email per conferma
    const context = String(body.context || '').trim();    // contesto (select)
    const note = String(body.note || '').trim();          // note opzionali
    const expires = String(body.expires || '').trim();    // scadenza opzionale
    const proof = String(body.proof || '').trim();        // 'Si' | 'No'

    // id e payload
    const id = randomUUID();
    const baseUrl = getBaseUrl(event);
    const publicUrl = `${baseUrl}/rs/${id}`;

    const record = {
      id,
      email,
      context,
      note,
      expires,
      createdAt: Date.now(),
      url: publicUrl,
      status: 'NEW'
    };

    // Salvataggio (tollerante se Blobs non configurato)
    const saveRes = await saveToBlobs(id, record);

    // Email di conferma (solo se richiesta)
    let mail = { ok: false, skipped: true };
    if (proof === 'Si' && email) {
      const subject = 'COLPA MIA — Il tuo Responsibility Switch';
      const text = `Ecco il tuo link personale:\n${publicUrl}\n\nTienilo, e inoltralo al destinatario.`;
      const html = `
        <p>Ecco il tuo link personale:</p>
        <p><a href="${publicUrl}">${publicUrl}</a></p>
        <p>Tienilo e inoltralo al destinatario.</p>
      `;
      try {
        mail = await sendEmail({ to: email, subject, text, html });
      } catch (e) {
        mail = { ok: false, error: e.message };
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        ok: true,
        id,
        url: publicUrl,
        saved: saveRes.ok,
        email: mail
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};
