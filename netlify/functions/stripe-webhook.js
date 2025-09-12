// netlify/functions/stripe-webhook.js
// Webhook Stripe per Netlify – senza "micro"
// - Verifica firma usando event.body (raw / base64)
// - Invia l'email al cliente (Resend)
// - Accumula minuti nel wallet (@netlify/blobs)
// - Nessuna scusa automatica per i pacchetti "COLPA_*"

const Stripe = require('stripe');
const { Resend } = require('resend');
const { getStore } = require('@netlify/blobs');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const RESEND = new Resend(process.env.RESEND_API_KEY);

// ---- utility --------------------------------------------------------------

const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <no-reply@colpamia.com>';
const MAIL_REPLY = 'colpamiaconsulenze@proton.me';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Mappa titoli (facoltativa) per mostrare un nome umano
function getTitleBySku(sku) {
  const map = safeJSON(process.env.PRICE_BY_SKU_JSON);
  if (map && typeof map === 'object') {
    // Se vuoi mostrare il titolo uguale allo SKU, basta fare return sku;
    // Qui proviamo a derivarlo leggendo map e facendo un nome "amichevole".
    // Esempio: SCUSA_BASE -> "Scusa Base"
    if (sku) {
      return sku
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/(^|\s)\S/g, (t) => t.toUpperCase());
    }
  }
  return sku || 'Prodotto';
}

// Mappa regole minuti per wallet
function getMinutesForSku(sku) {
  // Lettura da env PRICE_RULES_JSON (o fallback)
  const rules =
    safeJSON(process.env.PRICE_RULES_JSON) ||
    safeJSON(process.env.PRICE_RULES_JSON?.toLowerCase?.()) ||
    safeJSON(process.env.PRICE_RULES) ||
    {};

  // Fallback sensato se non trovato
  const fallback = {
    SCUSA_BASE: 10,
    SCUSA_DELUXE: 60,
    CONNESSIONE: 20,
    TRAFFICO: 20,
    RIUNIONE: 15,
    COLPA_LIGHT: 30,
    COLPA_FULL: 60,
    COLPA_DELUXE: 90,
  };

  if (rules && rules[sku] && typeof rules[sku].minutes === 'number') {
    return rules[sku].minutes;
  }
  return fallback[sku] || 0;
}

function safeJSON(s) {
  try {
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function addWalletMinutes(email, delta) {
  if (!email || !delta) return { before: 0, after: 0 };
  const store = getStore('wallet'); // namespace "wallet"
  const key = `wallet:${email.toLowerCase()}`;
  const currStr = await store.get(key);
  const before = parseInt(currStr || '0', 10) || 0;
  const after = before + delta;
  await store.set(key, String(after));
  return { before, after };
}

// Carica testo scusa via ai-excuse (se presente), altrimenti fallback
async function buildExcuse({ kind, context, variants = 1 }) {
  let lines = [];
  try {
    const ai = require('./ai-excuse'); // deve esportare una funzione/oggetto
    if (typeof ai.generate === 'function') {
      lines = await ai.generate({ kind, context, variants });
    } else if (typeof ai === 'function') {
      lines = await ai({ kind, context, variants });
    }
  } catch (e) {
    // Fallback molto semplice
    if (kind === 'CONNESSIONE') {
      lines = [
        'Ciao, ho problemi di connessione e non riesco a collegarmi. Ti aggiorno appena rientra la linea.',
      ];
    } else if (kind === 'TRAFFICO') {
      lines = [
        'Ciao, sono bloccato nel traffico per un incidente. Appena ho un orario credibile, ti scrivo.',
      ];
    } else if (kind === 'RIUNIONE') {
      lines = [
        'Ciao, la riunione sta sforando e non riesco a liberarmi. Ti aggiorno a breve con orari aggiornati.',
      ];
    } else {
      lines = [
        'Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.',
      ];
    }
    if (variants > 1) lines = Array(variants).fill(lines[0]);
  }
  if (!Array.isArray(lines)) lines = [String(lines || '')];
  return lines.filter(Boolean).slice(0, variants);
}

async function sendEmail({ to, subject, html }) {
  if (!to) return { id: null, status: 'skipped' };
  const r = await RESEND.emails.send({
    from: MAIL_FROM,
    to,
    reply_to: MAIL_REPLY,
    subject,
    html,
  });
  return { id: r?.id || null, status: r?.id ? 'sent' : 'error' };
}

// ---- handler --------------------------------------------------------------

exports.handler = async (event) => {
  // Stripe firma il "raw body": se Netlify lo passa base64, decodifichiamo.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/plain' },
      body: `Webhook Error: ${err.message}`,
    };
  }

  // Gestiamo solo checkout.session.completed
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: stripeEvent.type }) };
  }

  try {
    const sessionId = stripeEvent.data.object.id;

    // Recuperiamo sessione completa per email, line_items, ecc.
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer'],
    });

    const sku = session.client_reference_id || '';
    const title = getTitleBySku(sku);
    const email =
      (session.customer_details && session.customer_details.email) ||
      session.customer_email ||
      null;

    // Campo personalizzato "need" (contesto)
    let contextUsed = '';
    try {
      const cf = Array.isArray(session.custom_fields) ? session.custom_fields : [];
      const need = cf.find((f) => f.key === 'need' && f.text && f.text.value);
      contextUsed = need ? String(need.text.value || '') : '';
    } catch {}

    const minutes = getMinutesForSku(sku) || 0;

    // Pacchetti "prendo io la colpa": non inviamo scusa automatica
    const isColpa = /^COLPA_/i.test(sku);

    // 1) Wallet
    let walletAfter = null;
    if (email && minutes > 0) {
      const { after } = await addWalletMinutes(email, minutes);
      walletAfter = after;
    }

    // 2) Email
    let emailInfo = { status: 'skipped', id: null };
    if (email) {
      if (isColpa) {
        // Email di presa in carico: nessuna scusa automatica
        const html = `
          <h1>Prendo io la colpa — ${title}</h1>
          <p>Ciao! Il pagamento è andato a buon fine. Nessuna scusa automatica è stata inviata.</p>
          <p>Rispondi a questa email spiegandomi <b>in breve la situazione</b> (chi, dove, quando) e ti preparo il messaggio migliore.</p>
          ${
            minutes > 0
              ? `<p>Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>`
              : ''
          }
          <p>Se serve, scrivimi pure a <a href="mailto:${MAIL_REPLY}">${MAIL_REPLY}</a>.</p>
        `;
        emailInfo = await sendEmail({
          to: email,
          subject: `Preso in carico — ${title}`,
          html,
        });
      } else {
        // Generiamo scusa/e
        const variantsWanted = sku === 'SCUSA_DELUXE' ? 3 : 1;
        const kind =
          sku === 'CONNESSIONE' ? 'CONNESSIONE' :
          sku === 'TRAFFICO' ? 'TRAFFICO' :
          sku === 'RIUNIONE' ? 'RIUNIONE' :
          'BASE';

        const lines = await buildExcuse({
          kind,
          context: contextUsed,
          variants: variantsWanted,
        });

        const listHtml = lines
          .map((t, i) => `<li>${escapeHTML(t)}</li>`)
          .join('');

        const html = `
          <h1>La tua Scusa</h1>
          <ol>${listHtml}</ol>
          ${
            minutes > 0
              ? `<p>Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>`
              : ''
          }
          <p>Se ti serve un ritocco, rispondi a questa email (ti leggo da <b>${MAIL_REPLY}</b>).</p>
        `;

        emailInfo = await sendEmail({
          to: email,
          subject: `La tua Scusa — ${title}`,
          html,
        });
      }
    }

    // (WhatsApp opzionale: qui potresti integrare Twilio. Per ora: skipped)
    const waStatus = 'skipped';

    // Risposta OK
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        session_id: sessionId,
        sku,
        title,
        email: email || null,
        credited: minutes,
        wallet_after: walletAfter,
        email_sent: emailInfo.status,
        email_id: emailInfo.id,
        waStatus,
        context_used: contextUsed || null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'handle_failed', detail: String(err && err.message || err) }),
    };
  }
};

// ---- helpers --------------------------------------------------------------

function escapeHTML(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
