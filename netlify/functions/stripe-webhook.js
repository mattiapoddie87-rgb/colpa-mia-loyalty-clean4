// netlify/functions/stripe-webhook.js
// Webhook Stripe: accredita minuti + invia scuse (email & WhatsApp) con AI naturale/varia.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const twilio = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const OpenAI = require('openai');
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ---------- Helpers ----------
const JSON_MAP_RULES = safeJson(process.env.PRICE_RULES_JSON) || {}; // {price_id: {excuse:"...", minutes:10}}
const EMAIL_ALIASES   = safeJson(process.env.EMAIL_ALIASES_JSON)   || {}; // {"alias@..":"vero@.."}

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function isValidEmail(x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x||'')); }

function normEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return EMAIL_ALIASES[e] || e;
}

// Calcolo minuti: 1) PRICE_RULES_JSON (prioritario) 2) metadata.minutes su Price/Product
function calcMinutes(lineItems) {
  let tot = 0;
  for (const li of lineItems) {
    const price = li.price || {};
    const product = price.product || {};
    const qty = li.quantity || 1;

    if (JSON_MAP_RULES[price.id] && Number.isFinite(JSON_MAP_RULES[price.id].minutes)) {
      tot += (JSON_MAP_RULES[price.id].minutes * qty);
      continue;
    }
    const m1 = parseInt((price.metadata && price.metadata.minutes) || '', 10);
    const m2 = parseInt((product.metadata && product.metadata.minutes) || '', 10);
    const mins = (!isNaN(m1) ? m1 : (!isNaN(m2) ? m2 : 0));
    tot += mins * qty;
  }
  return tot;
}

function getAnyProductName(lineItems) {
  const li = (lineItems || [])[0];
  if (!li) return null;
  const price = li.price || {};
  const product = price.product || {};
  return price.nickname || product.name || null;
}

function countryNormPhone(phone) {
  const dflt = process.env.DEFAULT_COUNTRY_CODE || '+39';
  const p = String(phone || '').trim();
  if (!p) return null;
  if (/^\+/.test(p)) return p; // già E.164
  // es. 349xxxx -> +39 349xxxx
  return dflt + p.replace(/\D+/g, '');
}

// --------- AI: generatore scuse naturali & varie (UNA SOLA "grande" modifica) ---------
function pickNUnique(arr, n) {
  const bag = [...arr];
  const out = [];
  while (out.length < n && bag.length) {
    const i = Math.floor(Math.random() * bag.length);
    out.push(bag.splice(i, 1)[0]);
  }
  return out;
}

/**
 * Genera 3 scuse in italiano, naturali, diverse e plausibili.
 * Usa contesto, prodotto, canale e nome destinatario per personalizzare.
 */
async function generateExcuses({ context, productName, minutes, channel, recipientName }) {
  // Fallback soft se manca la chiave OpenAI
  if (!openai) {
    const base = context || 'un imprevisto';
    return [
      `Ciao${recipientName ? ' ' + recipientName : ''}, ho avuto ${base} e arrivo con qualche minuto di ritardo. Ti aggiorno a breve.`,
      `Mi scuso: è saltato fuori ${base}. Sto risolvendo e ti raggiungo appena possibile.`,
      `Coincidenza infelice: ${base}. Recupero subito e ti tengo informato finché non arrivo.`
    ];
  }

  const tones = pickNUnique(
    ['professionale', 'empatico', 'amichevole', 'determinato', 'ironico-leggero', 'formale'],
    3
  );

  const sys = [
    'Sei un ghostwriter italiano che scrive scuse realistiche, brevi e plausibili.',
    'Stile naturale: evita ripetizioni e rigidità da bot.',
    'Niente dati sensibili o dettagli falsificabili.',
    'Ogni scusa deve essere diversa: cambia struttura, lessico e ritmo.',
    'Massimo 1-3 frasi ciascuna.'
  ].join(' ');

  const user = {
    istruzioni: [
      'Genera esattamente 3 scuse in italiano, una per ciascun tono.',
      'Adatta il registro al canale (WhatsApp più colloquiale, email leggermente più curata).',
      'Inserisci un dettaglio concreto ma generico (es. “treno in ritardo”, “blocco in tangenziale”, “revisione urgente”).',
      'Non ripetere le stesse espressioni tra le 3 scuse.',
      'Restituisci JSON: {"varianti":[{"tono":"…","testo":"…"}, …]}',
      'Niente etichette tipo (base) e niente testo fuori JSON.'
    ].join(' '),
    contesto: {
      esigenza: context || null,
      prodotto: productName || null,
      minuti_accreditati: minutes || null,
      canale: channel || 'email',
      destinatario: recipientName || null,
      toni_richiesti: tones
    }
  };

  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 1.1,
    top_p: 0.92,
    presence_penalty: 0.85,
    frequency_penalty: 0.4,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(user) }
    ],
    response_format: { type: 'json_object' }
  });

  let out = [];
  try {
    const obj = JSON.parse(res.choices[0].message.content);
    out = (obj.varianti || []).map(v => String(v.testo || '').trim()).filter(Boolean);
  } catch (_) {
    out = [];
  }

  // Fallback ulteriore se il JSON non fosse perfetto
  if (out.length < 3) {
    const base = (context || productName || 'un imprevisto').toLowerCase();
    const saluto = channel === 'whatsapp'
      ? `Ciao${recipientName ? ' ' + recipientName : ''}`
      : (recipientName ? `Gentile ${recipientName}` : 'Buongiorno');
    out = [
      `${saluto}, si è creato un imprevisto legato a ${base}. Sto sistemando e arrivo a breve.`,
      `${saluto}, ho un contrattempo (${base}). Recupero il ritardo e ti aggiorno man mano.`,
      `${saluto}, imprevisto dell’ultimo minuto su ${base}. Ci sono e sto riorganizzando: ti tengo allineato.`
    ];
  }

  return out.slice(0, 3);
}

// --------- Invii ---------
async function sendEmail(to, subject, html) {
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM;
  if (!resend || !from || !isValidEmail(to)) return false;
  try {
    await resend.emails.send({ from, to, subject, html });
    return true;
  } catch (_) { return false; }
}

async function sendWhatsAppText(toE164, text) {
  if (!twilio || !toE164) return false;
  const from = process.env.TWILIO_FROM_WA; // es. whatsapp:+14155238886
  if (!from) return false;
  try {
    await twilio.messages.create({ from, to: `whatsapp:${toE164.replace(/^whatsapp:/,'')}`, body: text });
    return true;
  } catch (_) { return false; }
}

// --------- Wallet opzionale ---------
async function creditWalletIfAvailable(email, minutes, metadata) {
  try {
    const wallet = require('./wallet'); // opzionale
    if (wallet && typeof wallet.creditMinutes === 'function') {
      await wallet.creditMinutes(email, minutes, metadata);
    }
  } catch (_) {
    // nessun wallet locale: ignora
  }
}

// ======================================================
//                HANDLER WEBHOOK STRIPE
// ======================================================
exports.handler = async (event) => {
  try {
    // Stripe richiede RAW body per la firma
    const sig = event.headers['stripe-signature'];
    if (!sig) return { statusCode: 400, body: 'Missing signature' };

    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(event.rawBody || event.body, sig, whSecret);
    } catch (err) {
      return { statusCode: 400, body: `Signature error: ${err.message}` };
    }

    // Gestiamo solo eventi rilevanti
    if (stripeEvent.type === 'checkout.session.completed') {
      const s = stripeEvent.data.object;

      // Session deve essere payment & paid
      if (s.mode !== 'payment') return ok('Not a payment session');
      if (s.payment_status !== 'paid') return ok('Payment not captured');

      // PaymentIntent & idempotenza
      const piId = s.payment_intent;
      if (!piId) return ok('No payment_intent in session');

      const pi = await stripe.paymentIntents.retrieve(piId);
      if (pi.metadata && pi.metadata.colpamiaCredited === 'true') {
        return ok('Already credited');
      }

      // Email cliente
      const emailFromSession = (s.customer_details && s.customer_details.email) || s.customer_email || null;
      const email = normEmail(emailFromSession);
      if (!email) return ok('No email');

      // Line items
      const itemsResp = await stripe.checkout.sessions.listLineItems(s.id, {
        limit: 100,
        expand: ['data.price.product']
      });
      const items = itemsResp.data || [];
      const minutes = calcMinutes(items);
      if (minutes <= 0) return ok('No valid minutes');

      const productName = getAnyProductName(items);

      // "Esigenza" (custom_field key=need) se disponibile
      const needText =
        (s.custom_fields || []).find(f => f.key === 'need')?.text?.value ||
        (pi.metadata && pi.metadata.need) ||
        null;

      // Accredito wallet (se presente)
      await creditWalletIfAvailable(email, minutes, { session_id: s.id, piId });

      // Generazione scuse (una volta per email, già naturale/varia)
      const customerName = s.customer_details?.name || null;
      const excusesEmail = await generateExcuses({
        context: needText,
        productName,
        minutes,
        channel: 'email',
        recipientName: customerName
      });

      // Email
      const html =
        `<p>La tua Scusa è pronta ✅</p>
         <p>Hai ricevuto <b>${minutes}</b> minuti nel tuo wallet.</p>
         ${needText ? `<p><i>Contesto:</i> ${escapeHtml(needText)}</p>` : ''}
         <p>Tre varianti tra cui scegliere:</p>
         <ol>
           <li>${escapeHtml(excusesEmail[0])}</li>
           <li>${escapeHtml(excusesEmail[1])}</li>
           <li>${escapeHtml(excusesEmail[2])}</li>
         </ol>
         <p>Grazie da COLPA MIA.</p>`;

      const mailOk = await sendEmail(email, 'La tua Scusa è pronta ✅', html);

      // WhatsApp (invio testo unico con 3 varianti)
      let waOk = false;
      if (twilio && s.customer_details?.phone) {
        const waText =
          `La tua Scusa è pronta ✅\n` +
          (needText ? `Contesto: ${needText}\n` : ``) +
          `Hai ricevuto ${minutes} minuti nel tuo wallet.\n\n` +
          `1) ${excusesEmail[0]}\n\n2) ${excusesEmail[1]}\n\n3) ${excusesEmail[2]}`;
        waOk = await sendWhatsAppText(countryNormPhone(s.customer_details.phone), waText);
      }

      // Idempotenza: marchiamo il PI
      await stripe.paymentIntents.update(piId, {
        metadata: {
          ...(pi.metadata || {}),
          colpamiaCredited: 'true',
          colpamiaMinutes: String(minutes),
          colpamiaEmail: email,
          colpamiaEmailSent: mailOk ? 'true' : 'false',
          colpamiaWASent: waOk ? 'true' : 'false'
        }
      });

      return ok('done');
    }

    // Ignora altri eventi
    return ok('no-op');
  } catch (err) {
    return { statusCode: 500, body: `Webhook Error: ${err.message}` };
  }
};

// ---------- utilities ----------
function ok(msg) { return { statusCode: 200, body: msg }; }
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
