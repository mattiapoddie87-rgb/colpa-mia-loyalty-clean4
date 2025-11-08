// netlify/functions/session-email.js
// INVIA la scusa che abbiamo salvato nel blob "wallet"

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

// *** PRENDI GLI STESSI VALORI USATI IN balance2.js ***
const SITE_ID = process.env.NETLIFY_SITE_ID || 'INSERISCI_SITE_ID_NETLIFY';
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN || 'INSERISCI_NETLIFY_BLOBS_TOKEN';

// *** PARAMETRI MAIL (esempio Mailgun) ***
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'INSERISCI_DOMINIO_MAILGUN';
const MAILGUN_KEY = process.env.MAILGUN_KEY || 'INSERISCI_APIKEY_MAILGUN';
const MAIL_FROM = process.env.MAIL_FROM || 'Colpa Mia <no-reply@tuodominio.it>';

async function sendMail(to, subject, html, text) {
  const form = new URLSearchParams();
  form.append('from', MAIL_FROM);
  form.append('to', to);
  form.append('subject', subject);
  form.append('text', text);
  form.append('html', html);

  const resp = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from('api:' + MAILGUN_KEY).toString('base64'),
    },
    body: form,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error('Invio mail fallito: ' + body);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'method not allowed' };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: 'json non valido' };
  }

  const email = (payload.email || '').trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, headers: CORS, body: 'email obbligatoria' };
  }

  try {
    const store = getStore({
      name: 'wallet',
      siteId: SITE_ID,
      token: BLOB_TOKEN,
    });

    const data = await store.get(email, { type: 'json' });

    if (!data) {
      return {
        statusCode: 404,
        headers: CORS,
        body: JSON.stringify({ error: 'nessun dato trovato per questa email' }),
      };
    }

    // dove può stare la scusa:
    // 1) data.last_excuse
    // 2) l’ultimo elemento di data.history[].excuse
    let excuse =
      data.last_excuse ||
      (Array.isArray(data.history) && data.history.length
        ? data.history[data.history.length - 1].excuse
        : '');

    if (!excuse) {
      excuse = 'Ciao, la tua scusa è stata registrata ma non è stato trovato un testo dettagliato.';
    }

    const subject = 'La tua scusa COLPA MIA';
    const html = `
      <div style="font-family:sans-serif">
        <h2>La tua scusa è pronta</h2>
        <p><strong>Contesto:</strong> ${data.last_context || '-'}</p>
        <p style="white-space:pre-line">${excuse}</p>
        <hr/>
        <p style="font-size:12px;color:#666">Se non hai richiesto questa scusa puoi ignorare questa email.</p>
      </div>
    `;
    const text = `La tua scusa è pronta.\n\n${excuse}\n`;

    await sendMail(email, subject, html, text);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
