// netlify/functions/stripe-webhook.js
// Riceve l'evento Stripe, accredita minuti nel wallet e manda la mail con la SCUSA VERA.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

// helper: parse JSON di env
function parseEnvJSON(name) {
  try {
    return JSON.parse(process.env[name] || '{}');
  } catch {
    return {};
  }
}

// mappa minuti fallback se non arrivano da Stripe
const PRICE_RULES = parseEnvJSON('PRICE_RULES_JSON') || {};

// alias eventuali usati nel checkout
const ALIAS = {
  BASE_5: 'COLPA_LIGHT',
  BASE_15: 'COLPA_FULL',
  PREMIUM_30: 'COLPA_DELUXE',
};

// 1) genera una scusa credibile in base al contesto o allo SKU
function buildExcuse(meta = {}) {
  const ctx =
    meta.context ||
    meta.excuse ||
    meta.sku ||
    'SCUSA_BASE';

  const tone = meta.tone || 'neutro';

  // normalizza
  const key = String(ctx).toUpperCase();

  // set di modelli minimi. Puoi aggiungerne quanti vuoi.
  const templates = {
    SCUSA_BASE: [
      'Ciao, ho avuto un imprevisto reale e non sono riuscito a rispettare i tempi. Ti aggiorno entro oggi con una proposta di recupero.',
      'Ciao, mi scuso per il disguido di oggi. Ho dovuto gestire un’urgenza e non avrei potuto dirlo prima. Ti propongo una nuova fascia oraria.',
    ],
    SCUSA_DELUXE: [
      'Ciao, prendo io la responsabilità del ritardo. È dipeso da una gestione interna non ottimale e sto già sistemando. Ti propongo subito un recupero e, se vuoi, ti invio anche un promemoria più dettagliato.',
      'Ciao, ti confermo che il disguido è da imputare a noi. Per correttezza ti propongo una ricalendarizzazione prioritaria, così da non farti perdere altro tempo.',
    ],
    CONNESSIONE: [
      'Ciao, ho avuto un problema reale di connessione e non riuscivo a collegarmi. Ora ho ripristinato e sono disponibile per recuperare.',
      'Ciao, la linea è andata giù proprio mentre dovevo collegarmi e non avevo un’alternativa immediata. Se per te va bene ti propongo uno slot sostitutivo.',
    ],
    TRAFFICO: [
      'Ciao, sono rimasto bloccato in un traffico imprevisto e non sarei arrivato puntuale. Preferisco dirtelo con trasparenza e proporti un nuovo orario.',
    ],
    RIUNIONE: [
      'Ciao, la riunione precedente si è allungata e non mi ha permesso di essere puntuale. Prendo io la responsabilità e ti propongo una nuova finestra.',
    ],
    COLPA_LIGHT: [
      'Ciao, piccolo imprevisto da parte nostra. Recuperiamo senza problemi, dimmi tu quando è più comodo.',
    ],
    COLPA_FULL: [
      'Ciao, ti confermo che la responsabilità è nostra. Ti propongo un recupero prioritario così non perdi altro tempo.',
    ],
    COLPA_DELUXE: [
      'Ciao, prendo io la responsabilità dell’inconveniente. Ti propongo subito una soluzione alternativa e rimango disponibile se preferisci un messaggio più formale.',
    ],
  };

  const list = templates[key] || templates.SCUSA_BASE;
  // scelta semplice random
  const excuse = list[Math.floor(Math.random() * list.length)];

  // opzionale: adatta tono
  if (tone === 'empatica') {
    return excuse + ' Capisco che ti abbia creato un disagio e voglio evitarlo in futuro.';
  }
  return excuse;
}

// 2) invio mail via MailChannels (nativo Netlify)
async function sendMail({ to, subject, html }) {
  const from = process.env.MAIL_FROM || 'noreply@colpamia.com';

  const payload = {
    personalizations: [
      {
        to: [{ email: to }],
      },
    ],
    from: { email: from, name: 'COLPA MIA' },
    subject,
    content: [
      {
        type: 'text/html',
        value: html,
      },
    ],
  };

  const resp = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error('mailchannels error', txt);
  }
}

// 3) aggiorna wallet
async function creditWallet({ email, sku, minutes, historyItem }) {
  const siteId = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  const store = getStore({ name: 'wallet', siteId, token });

  const key = email.toLowerCase();
  const current = (await store.get(key, { type: 'json' })) || {
    minutes: 0,
    points: 0,
    tier: 'None',
    history: [],
  };

  const newMinutes = (current.minutes || 0) + (minutes || 0);
  const newHistory = current.history || [];
  if (historyItem) newHistory.unshift(historyItem);

  await store.set(key, {
    minutes: newMinutes,
    points: current.points || 0,
    tier: current.tier || 'None',
    history: newHistory.slice(0, 50), // limitiamo
  });

  console.log('wallet aggiornato per', email, 'minuti +', minutes);
}

exports.handler = async (event) => {
  // Stripe manda POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let stripeEvent;

  // 1. verifichiamo la firma se il secret c'è
  if (endpointSecret) {
    // per verificare ci serve stripe sdk
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        sig,
        endpointSecret
      );
    } catch (err) {
      console.error('invalid signature', err.message);
      return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }
  } else {
    // fallback: prendiamo direttamente il body
    try {
      stripeEvent = JSON.parse(event.body);
    } catch (err) {
      return { statusCode: 400, body: 'Invalid payload' };
    }
  }

  // 2. gestiamo solo checkout.session.completed
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  const session = stripeEvent.data.object;

  const email = (session.customer_email || session.customer_details?.email || '').toLowerCase();
  const meta = session.metadata || {};
  const rawSku = meta.sku;
  const sku = PRICE_RULES[rawSku] ? rawSku : (ALIAS[rawSku] || rawSku);

  // minuti: prima metadata, poi PRICE_RULES, altrimenti 0
  let minutes = 0;
  if (meta.minutes) {
    minutes = Number(meta.minutes) || 0;
  } else if (PRICE_RULES[sku]?.minutes) {
    minutes = Number(PRICE_RULES[sku].minutes) || 0;
  }

  // costruiamo la scusa
  const excuseText = buildExcuse(meta);

  // aggiorniamo wallet (se abbiamo email)
  if (email) {
    await creditWallet({
      email,
      sku,
      minutes,
      historyItem: {
        created: Math.floor(Date.now() / 1000),
        sku,
        minutes,
        amount: session.amount_total || 0,
        currency: session.currency || 'eur',
      },
    });
  }

  // mandiamo mail
  if (email) {
    const subject = 'La tua scusa è pronta';
    const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;background:#0b0d12;color:#fff">
      <h2 style="margin-top:0">La tua scusa è pronta</h2>
      <p style="color:#9ca3af;font-size:14px;margin-bottom:12px">
        Contesto: <strong>${meta.context || sku || 'SCUSA_BASE'}</strong>
      </p>
      <div style="background:#111827;border:1px solid #1f2937;border-radius:10px;padding:14px;margin-bottom:16px">
        <p style="white-space:pre-line;margin:0">${excuseText}</p>
      </div>
      <p style="font-size:12px;color:#9ca3af">Tempo accreditato: <strong>${minutes}</strong> minuti.</p>
      <p style="font-size:12px;color:#9ca3af">Se vuoi una variante, rispondi a questa email indicando tono e destinatario.</p>
    </div>
    `;
    await sendMail({ to: email, subject, html });
  }

  return { statusCode: 200, body: 'ok' };
};
