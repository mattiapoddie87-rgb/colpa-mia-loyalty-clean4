// netlify/functions/rs-request.js
const { randomUUID } = require('crypto');

// ----------------- helpers -----------------
function getBaseUrl(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`;
}

function isTrue(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'yes' || s === 'si' || s === 'sì' || s === 'true' || s === '1';
}

function computeExpiresAt(ttl) {
  const now = Date.now();
  if (ttl === '24h') return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (ttl === '7d')  return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  return null; // nessuna scadenza
}

async function saveToBlobs(id, data) {
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('rs'); // namespace
    await store.setJSON(id, data, { metadata: { createdAt: Date.now() } });
    return { ok: true };
  } catch (e) {
    console.error('blobs_set_failed', e?.message || e);
    return { ok: false, error: e.message };
  }
}

async function sendWithResend({ from, to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !from) return { ok: false, error: 'resend_not_configured' };
  const { Resend } = require('resend');
  const resend = new Resend(key);
  await resend.emails.send({ from, to: Array.isArray(to) ? to : [to], subject, text, html });
  return { ok: true };
}

async function sendWithSMTP({ from, to, subject, html }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return { ok: false, error: 'smtp_not_configured' };

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user, pass }
  });
  const fromAddr = process.env.EMAIL_FROM || `COLPA MIA <${user}>`;
  await transporter.sendMail({ from: fromAddr, to, subject, html });
  return { ok: true };
}

async function sendEmail({ to, link }) {
  if (!to) return { ok: false, error: 'missing_to' };

  const from =
    process.env.RS_FROM_EMAIL ||
    process.env.RESEND_FROM ||
    process.env.EMAIL_FROM ||
    process.env.FROM_EMAIL ||
    '';

  const subject = 'COLPA MIA — Il tuo Responsibility Switch';
  const text    = `Ecco il tuo link personale:\n${link}\n\nTienilo e inoltralo al destinatario.`;
  const html    = `<p>Ecco il tuo link personale:</p><p><a href="${link}">${link}</a></p><p>Tienilo e inoltralo al destinatario.</p>`;

  // 1) Resend
  try {
    const r = await sendWithResend({ from, to, subject, text, html });
    if (r.ok) return r;
  } catch (e) {
    // continua col fallback
  }
  // 2) SMTP fallback
  try {
    const r = await sendWithSMTP({ from, to, subject, html });
    if (r.ok) return r;
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
  return { ok: false, error: 'no_email_provider' };
}

// ----------------- handler -----------------
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

    const email   = String(body.email || '').trim();
    const context = String(body.context || '').trim();
    const note    = String(body.note || '').trim();
    const ttl     = String(body.ttl || body.expires || '').trim(); // accetta ttl o expires
    const proof   = body.proof; // yes/no/Si…

    const id      = randomUUID();
    const baseUrl = getBaseUrl(event);
    const url     = `${baseUrl}/rs/${id}`;
    const expiresAt = computeExpiresAt(ttl);

    const record = {
      id,
      url,
      email,
      context,
      note,
      ttl,
      expiresAt,
      createdAt: Date.now(),
      status: 'NEW'
    };

    const saved = await saveToBlobs(id, record);

    // invio email solo se richiesto
    let emailResult = { ok: false, skipped: true };
    if (isTrue(proof) && email) {
      try {
        emailResult = await sendEmail({ to: email, link: url });
      } catch (e) {
        emailResult = { ok: false, error: e.message || String(e) };
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, id, url, saved: !!saved.ok, email: emailResult })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: e.message || String(e) })
    };
  }
};
