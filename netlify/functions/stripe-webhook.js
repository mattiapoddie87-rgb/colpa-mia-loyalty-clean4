// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');

function parseEnvJSON(name) {
  try { return JSON.parse(process.env[name] || '{}'); }
  catch { return {}; }
}

const PRICE_RULES = parseEnvJSON('PRICE_RULES_JSON');
const SKU_ALIASES = { BASE_5: 'COLPA_LIGHT', BASE_15: 'COLPA_FULL', PREMIUM_30: 'COLPA_DELUXE' };

// Genera la scusa in base al contesto o SKU
function buildExcuse(meta = {}) {
  const ctx = (meta.context || meta.excuse || meta.sku || 'SCUSA_BASE').toUpperCase();
  const tone = meta.tone || 'neutro';
  const templates = {
    SCUSA_BASE: [
      'Ciao, ho avuto un imprevisto reale e non sono riuscito a rispettare i tempi. Ti aggiorno entro oggi con una proposta di recupero.',
      'Ciao, mi scuso per il disguido di oggi. Ho dovuto gestire un’urgenza. Ti propongo una nuova fascia oraria.',
    ],
    SCUSA_DELUXE: [
      'Ciao, prendo io la responsabilità del ritardo. Sto già sistemando. Ti propongo una nuova fascia prioritaria.',
      'Ciao, è un nostro disguido. Ti propongo di recuperare subito così da non farti perdere altro tempo.',
    ],
    CONNESSIONE: [
      'Ciao, ho avuto un problema di connessione e non riuscivo a collegarmi. Ora ho ripristinato e sono disponibile.',
    ],
    TRAFFICO: [
      'Ciao, sono rimasto bloccato in un traffico imprevisto e non sarei arrivato puntuale. Ti propongo un nuovo orario.',
    ],
    RIUNIONE: [
      'Ciao, la riunione precedente si è allungata. Prendo io la responsabilità. Ti propongo una nuova finestra.',
    ],
    COLPA_LIGHT: [
      'Ciao, piccolo imprevisto da parte nostra. Ti propongo un recupero immediato, fammi sapere.',
    ],
    COLPA_FULL: [
      'Ciao, ti confermo che la responsabilità è nostra. Ti propongo un recupero prioritario.',
    ],
    COLPA_DELUXE: [
      'Ciao, prendo io la responsabilità dell’inconveniente. Ti propongo subito una soluzione alternativa.',
    ],
  };

  const list = templates[ctx] || templates.SCUSA_BASE;
  const excuse = list[Math.floor(Math.random() * list.length)];
  return tone === 'empatica' ? excuse + ' Capisco il disagio causato.' : excuse;
}

async function sendMail({ to, subject, html }) {
  const from = process.env.MAIL_FROM || 'COLPA MIA <noreply@colpamia.com>';
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: 'COLPA MIA' },
    subject,
    content: [{ type: 'text/html', value: html }],
  };
  await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function creditWallet(email, minutes, sku, amount, currency) {
  const siteId = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  const store  = getStore({ name: 'wallet', siteId, token });
  const key    = email.toLowerCase();
  const current = (await store.get(key, { type: 'json' })) || {
    minutes: 0, points: 0, tier: 'None', history: [],
  };
  current.minutes = (current.minutes || 0) + minutes;
  current.history.unshift({
    id: Math.random().toString(36).slice(2), // identificatore transazione
    created: Math.floor(Date.now() / 1000),
    sku,
    minutes,
    amount,
    currency,
  });
  await store.set(key, current, { type: 'json' });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  const session = stripeEvent.data.object;
  const email   = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const meta    = session.metadata || {};
  let sku       = meta.sku;
  sku           = PRICE_RULES[sku] ? sku : (SKU_ALIASES[sku] || sku);

  // minuti: metadata.minutes -> PRICE_RULES -> 0
  let minutes = meta.minutes ? Number(meta.minutes) : (PRICE_RULES[sku]?.minutes || 0);
  minutes     = isNaN(minutes) ? 0 : minutes;

  // Genera scusa e manda mail
  if (email) {
    await creditWallet(email, minutes, sku, session.amount_total, session.currency);
    const excuse = buildExcuse(meta);
    const subject = 'La tua scusa è pronta';
    const body = `
      <h2>La tua scusa è pronta</h2>
      <p><strong>Contesto:</strong> ${meta.context || sku}</p>
      <p><strong>Scusa generata:</strong></p>
      <p>${excuse}</p>
      <p><strong>Minuti accreditati:</strong> ${minutes}</p>
    `;
    await sendMail({ to: email, subject, html: body });
  }

  return { statusCode: 200, body: 'ok' };
};
