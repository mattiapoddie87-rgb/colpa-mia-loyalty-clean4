// netlify/functions/session-email.js
// Invia la scusa via email dopo l'acquisto Stripe

const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { getStore } = require('@netlify/blobs');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const SITE_ID = process.env.NETLIFY_SITE_ID;
const BLOB_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS };

  try {
    const body = JSON.parse(event.body || '{}');
    let email = (body.email || '').trim().toLowerCase();
    const sessionId = (body.session_id || '').trim();

    // Se non c'è email ma c'è session_id, ricava l'email da Stripe
    if (!email && sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      email =
        session?.customer_details?.email ||
        session?.customer_email ||
        null;
    }

    if (!email) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'missing_email' }),
      };
    }

    if (!SITE_ID || !BLOB_TOKEN) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'missing Netlify blob credentials' }),
      };
    }

    // Recupera la scusa salvata nel blob
    const store = getStore({ name: 'wallet', siteID: SITE_ID, token: BLOB_TOKEN });
    const data = await store.get(email, { type: 'json' });

    const excuse = data?.excuse || data?.scusa || 'La tua scusa è in viaggio nel cyberspazio.';

    // Configura SMTP
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Invia la mail
    await transporter.sendMail({
      from: `"COLPA MIA" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'La tua Scusa è pronta 🕶️',
      text: excuse,
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#111;">
               <h2>La tua scusa è pronta</h2>
               <p>${excuse}</p>
               <hr>
               <p style="font-size:13px;color:#555;">Grazie per aver usato COLPA MIA</p>
             </div>`,
    });

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, email }),
    };
  } catch (err) {
    console.error('Errore invio scusa:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err.message || err) }),
    };
  }
};
