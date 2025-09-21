// netlify/functions/rs-test-email.js
exports.handler = async (event) => {
  try {
    // Accetta sia query sia body
    const qs = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    const to = String(qs.to || body.to || '').trim();

    // Mittente: compatibile con nomi vecchi e nuovi
    const FROM =
      process.env.RS_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      process.env.FROM_EMAIL ||
      '';

    const RESEND_KEY = process.env.RESEND_API_KEY;

    if (!to) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'missing_to' })
      };
    }
    if (!FROM || !RESEND_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'nessun provider configurato' })
      };
    }

    const { Resend } = require('resend');
    const resend = new Resend(RESEND_KEY);

    await resend.emails.send({
      from: FROM,           // es: 'COLPA MIA <noreply@tuodominio.com>'
      to: [to],             // sempre array: evita il "Missing `to`"
      subject: 'ColpaMia — Test email',
      text: 'Funziona ✅'
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};
