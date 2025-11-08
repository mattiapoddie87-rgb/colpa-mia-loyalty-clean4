// netlify/functions/session-email.js

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

const SITE_ID = process.env.NETLIFY_SITE_ID || 'INSERISCI_SITE_ID_NETLIFY';
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN || 'INSERISCI_NETLIFY_BLOBS_TOKEN';

// opzionale: se non li metti, la function non esplode, ti restituisce la scusa
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_KEY = process.env.MAILGUN_KEY;
const MAIL_FROM = process.env.MAIL_FROM || 'Colpa Mia <no-reply@tuodominio.it>';

async function sendMail(to, subject, html, text) {
  if (!MAILGUN_DOMAIN || !MAILGUN_KEY) {
    // niente provider: salto l’invio
    return { skipped: true };
  }

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
    throw new Error('invio mail fallito: ' + body);
  }

  return { skipped: false };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'method not allowed' };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: 'json non valido' };
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, headers: CORS, body: 'email obbligatoria' };
  }

  try {
    const store = getStore({
      name: 'wallet',
      siteID: SITE_ID,   // ← di nuovo: D maiuscola
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

    let excuse =
      data.last_excuse ||
      (Array.isArray(data.history) && data.history.length
        ? data.history[data.history.length - 1].excuse
        : '');

    if (!excuse) {
      excuse = 'Ciao, la tua scusa è stata registrata ma nel blob non c’è un testo dettagliato.';
    }

    const subject = 'La tua scusa COLPA MIA';
    const html = `
      <div style="font-family:sans-serif">
        <h2>La tua scusa è pronta</h2>
        <p><strong>Contesto:</strong> ${data.last_context || '-'}</p>
        <p style="white-space:pre-line">${excuse}</p>
      </div>
    `;
    const text = `La tua scusa è pronta.\n\n${excuse}\n`;

    let mailInfo = { skipped: true };
    try {
      mailInfo = await sendMail(email, subject, html, text);
    } catch (mailErr) {
      // non blocco la risposta
      mailInfo = { skipped: false, error: mailErr.message };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        sent: !mailInfo.skipped,
        excuse,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
