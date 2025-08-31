// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Resend (email) — safe require
let resend = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
} catch (_) {
  // pacchetto non installato: ignora, non bloccare la function
}

// Twilio (WhatsApp) — safe require
let twilioClient = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const tw = require('twilio');
    twilioClient = tw(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
} catch (_) {
  // pacchetto non installato: ignora
}

const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';
const FROM_WA   = process.env.TWILIO_FROM_WA || '';
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || '+39';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, body) {
  return { statusCode: status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

const RULES = safeJson(process.env.PRICE_RULES_JSON) || {};
const EMAIL_ALIASES = safeJson(process.env.EMAIL_ALIASES_JSON) || {};

function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return e ? (EMAIL_ALIASES[e] || e) : null;
}

function calcMinutesFromItems(items) {
  let tot = 0;
  for (const li of items) {
    const price = li.price || {};
    const product = price.product || {};
    let minutes = 0;

    if (RULES[price.id]?.minutes) {
      minutes = Number(RULES[price.id].minutes) || 0;
    } else {
      const m1 = parseInt(price?.metadata?.minutes || '', 10);
      const m2 = parseInt(product?.metadata?.minutes || '', 10);
      minutes = !isNaN(m1) ? m1 : (!isNaN(m2) ? m2 : 0);
    }
    tot += minutes * (li.quantity || 1);
  }
  return tot;
}
function pickExcuseType(items) {
  for (const li of items) {
    const price = li.price || {};
    if (RULES[price.id]?.excuse) return RULES[price.id].excuse;
  }
  return 'base';
}

function buildEmailHtml({ minutes }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <h2>La tua Scusa è pronta ✅</h2>
    <p>Hai ricevuto <b>${minutes}</b> minuti nel tuo wallet.</p>
    <ol>
      <li>Mi dispiace, ho avuto un imprevisto. Arrivo appena possibile.</li>
      <li>Scusa il ritardo, sto gestendo un contrattempo. Ti aggiorno tra poco.</li>
      <li>Ti chiedo pazienza: situazione imprevista. Grazie mille.</li>
    </ol>
    <p>Grazie da COLPA MIA.</p>
  </div>`;
}
function buildWhatsappText({ minutes }) {
  return [
    `La tua Scusa è pronta ✅`,
    ``,
    `Hai ricevuto ${minutes} minuti nel tuo wallet.`,
    ``,
    `Suggerimenti pronti all’uso:`,
    `1) Mi dispiace, ho avuto un imprevisto. Arrivo appena possibile.`,
    `2) Scusa il ritardo, sto gestendo un contrattempo. Ti aggiorno tra poco.`,
    `3) Ti chiedo pazienza: situazione imprevista. Grazie mille.`,
    ``,
    `— COLPA MIA`
  ].join('\n');
}
async function sendEmail(to, minutes) {
  if (!resend) return;
  await resend.emails.send({
    from: MAIL_FROM,
    to,
    subject: 'La tua Scusa è pronta ✅',
    html: buildEmailHtml({ minutes }),
  });
}
function toE164(phone) {
  if (!phone) return null;
  const p = phone.trim();
  if (p.startsWith('+')) return `whatsapp:${p}`;
  return `whatsapp:${DEFAULT_CC}${p.replace(/\D/g,'')}`;
}
async function sendWhatsApp(phone, minutes) {
  if (!twilioClient || !FROM_WA) return;
  const to = toE164(phone);
  if (!to) return;
  await twilioClient.messages.create({
    from: FROM_WA,
    to,
    body: buildWhatsappText({ minutes }),
  });
}

async function creditAndNotify({ session, lineItems }) {
  const email = normalizeEmail(
    session.customer_details?.email || session.customer_email || null
  );
  if (!email) throw new Error('Email mancante nella sessione');

  const minutes = calcMinutesFromItems(lineItems);
  if (minutes <= 0) throw new Error('Nessun articolo valido per accredito');

  const piId = String(session.payment_intent || '');
  if (!piId) throw new Error('PaymentIntent assente');

  const pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.metadata?.colpamiaCredited === 'true') {
    return { email, minutes, credited: false, reason: 'già accreditato' };
  }

  try {
    const wallet = require('./wallet');
    if (wallet?.creditMinutes) {
      await wallet.creditMinutes(email, minutes, {
        phone: session.customer_details?.phone || null,
        session_id: session.id,
        piId
      });
    }
  } catch (_) {}

  await stripe.paymentIntents.update(piId, {
    metadata: { ...(pi.metadata || {}), colpamiaCredited: 'true' }
  });

  try {
    await sendEmail(email, minutes);
    await stripe.paymentIntents.update(piId, {
      metadata: { ...(pi.metadata || {}), colpamiaEmailSent: 'true' }
    });
  } catch (e) { console.error('email fail', e?.message || e); }

  try {
    const phone = session.customer_details?.phone || null;
    if (phone) await sendWhatsApp(phone, minutes);
  } catch (e) { console.error('wa fail', e?.message || e); }

  return { email, minutes, credited: true };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod === 'GET') return json(200, { ok: true });

    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return json(400, { error: 'Missing stripe-signature header' });

    // usa il body grezzo (se base64, decodificalo)
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    let evt;
    try {
      evt = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error('signature verify fail:', e?.message || e);
      return json(400, { error: 'Signature verification failed' });
    }

    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object;
      const items = await stripe.checkout.sessions.listLineItems(s.id, {
        limit: 100,
        expand: ['data.price.product']
      });
      const out = await creditAndNotify({ session: s, lineItems: items.data });
      console.log('credited:', out);
      return json(200, { ok: true });
    }

    if (evt.type === 'invoice.payment_succeeded') {
      return json(200, { ok: true });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error('webhook error:', err?.message || err);
    return json(500, { error: 'Internal' });
  }
};
