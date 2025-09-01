// netlify/functions/stripe-webhook.js
// Stripe webhook: accredita minuti, invia email e (se disponibile) WhatsApp.
// Robusto su: recupero telefono, formattazione E.164, idempotenza e logging errori Twilio.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const crypto = require('crypto');

// --- Resend (Email)
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

// --- Twilio (WhatsApp)
const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const defaultCC = (process.env.DEFAULT_COUNTRY_CODE || '+39').trim();
const twilio = (twilioSid && twilioToken ? require('twilio')(twilioSid, twilioToken) : null);

// --- Mapping prezzi -> regole (minuti + tag prodotto per prompt)
function readJsonEnv(key) {
  try { return JSON.parse(process.env[key] || '{}'); } catch { return {}; }
}
const PRICE_RULES = readJsonEnv('PRICE_RULES_JSON'); // { price_xxx: { minutes: 10, excuse: "base" } }

// Utilità base
function httpResp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function pick(x, k, d = null) { try { return k.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), x) ?? d; } catch { return d; } }

// --- Helpers: telefono
function onlyDigits(s) { return String(s || '').replace(/[^\d]/g, ''); }
function isE164(s) { return /^(\+)\d{6,15}$/.test(String(s || '')); }

// Normalizza in E.164 e aggiunge prefisso se manca (es. +39), poi prefisso "whatsapp:" richiesto da Twilio
function asWhatsApp(toRaw) {
  let to = String(toRaw || '').trim();

  // già in formato "whatsapp:+NNN..."
  if (/^whatsapp:\+\d{6,15}$/.test(to)) return to;

  // già e164
  if (isE164(to)) return `whatsapp:${to}`;

  // numeri tipo 349..., 0039..., 39...
  let d = onlyDigits(to);

  // rimuovi 00 iniziali
  if (d.startsWith('00')) d = d.slice(2);

  // aggiungi country code se manca
  if (!d.startsWith(defaultCC.replace('+', ''))) {
    d = defaultCC.replace('+', '') + d;
  }
  return `whatsapp:+${d}`;
}

// Tenta di recuperare il telefono da più fonti della sessione/PI
function extractPhoneCandidates(session, paymentIntent) {
  const out = new Set();

  const sPhone = pick(session, 'customer_details.phone');
  if (sPhone) out.add(sPhone);

  const ch = pick(paymentIntent, 'charges.data.0');
  const chPhone = pick(ch, 'billing_details.phone');
  if (chPhone) out.add(chPhone);

  // custom_fields della Checkout Session (se hai abilitato un campo "phone" in futuro)
  const customFields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  customFields.forEach(cf => {
    if (cf?.key?.toLowerCase() === 'phone' && cf?.text?.value) out.add(cf.text.value);
  });

  return Array.from(out);
}

// --- AI prompt "migliorato": più naturale, senza ripetere letteralmente il contesto
function buildExcuses(context, productTag) {
  // Rendi il contesto d’ispirazione, non da copiare: massimizza naturalezza e varietà.
  const c = String(context || '').trim();
  const tag = String(productTag || '').trim();

  // 3 varianti crescenti per email; la breve la riutilizziamo per WhatsApp
  // NB: evitiamo qualsiasi saluto iniziale, “Ciao Nome”, o firma—il cliente la incolla in chat.
  const basePool = [
    // concisa
    (ctx) => `Ho avuto un imprevisto serio e sto riorganizzando al volo. Arrivo più tardi del previsto; ti aggiorno tra poco.`,
    // neutra
    (ctx) => `È saltata fuori una cosa urgente sul lavoro/famiglia che non posso rimandare. Sto sistemando e ti scrivo appena ho chiaro l’orario.`,
    // empatica
    (ctx) => `Situazione imprevista che mi blocca un attimo. Non voglio darti buca: mi prendo qualche minuto e ti aggiorno a breve con un orario più preciso.`
  ];

  // Leggera specializzazione in base al tag del prodotto (se presente)
  function specialize(fn, t) {
    const s = (t || '').toLowerCase();
    if (!s) return fn;
    if (s.includes('riunione')) {
      return (ctx) => `Mi è entrata una riunione non prevista che sta sforando. Sto cercando di chiudere rapidamente; ti tengo aggiornato fra poco.`;
    }
    if (s.includes('connessione') || s.includes('ko')) {
      return (ctx) => `Linea/connessione K.O. proprio ora. Sto cercando una soluzione rapida e ti aggiorno appena riparte tutto.`;
    }
    if (s.includes('deluxe') || s.includes('executive')) {
      return (ctx) => `È sopraggiunto un imprevisto di priorità alta: sto riorganizzando per minimizzare il ritardo. A brevissimo ti invio un nuovo orario.`;
    }
    return fn;
  }

  const v1 = specialize(basePool[0], tag)(c);
  const v2 = specialize(basePool[1], tag)(c);
  const v3 = specialize(basePool[2], tag)(c);

  return { short: v1, variants: [v1, v2, v3] };
}

// --- Email via Resend
async function sendEmail(to, minutes, excuses) {
  const { variants } = excuses;
  const html = `
    <div style="font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v => `<p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px;">${v}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
      <p style="font-size:12px; color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
    </div>
  `;

  await resend.emails.send({
    from: MAIL_FROM,
    to,
    subject: 'La tua scusa è pronta ✅',
    html
  });
}

// --- WhatsApp via Twilio (corta, informale)
async function sendWhatsApp(toRaw, message, paymentIntentId) {
  if (!twilio || !twilioFromWa) return { ok: false, reason: 'twilio_not_configured' };

  const to = asWhatsApp(toRaw);

  try {
    await twilio.messages.create({
      from: twilioFromWa,   // es. "whatsapp:+14155238886"
      to,                   // es. "whatsapp:+39......."
      body: message
    });
    return { ok: true };
  } catch (err) {
    // Log utile su Stripe per debug post-mortem
    try {
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          ...( (await stripe.paymentIntents.retrieve(paymentIntentId)).metadata || {} ),
          colpamiaWaError: String(err?.message || err?.code || 'wa_error')
        }
      });
    } catch {}
    return { ok: false, reason: err?.message || 'wa_error' };
  }
}

// --- Accredito minuti (qui è un placeholder: aggancia la tua logica/wallet locale se serve)
async function creditMinutes(email, minutes, info = {}) {
  // Se hai una function "wallet" locale, la puoi richiamare qui.
  // In assenza, non facciamo nulla (solo idempotenza su Stripe a chiudere il loop).
  return true;
}

// --- Webhook handler
exports.handler = async (event) => {
  try {
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return httpResp(400, { error: 'missing signature' });

    // Verifica firma Stripe
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);

    if (stripeEvent.type !== 'checkout.session.completed') {
      return httpResp(200, { received: true, ignored: stripeEvent.type });
    }

    const session = stripeEvent.data.object;
    if (session.mode !== 'payment') return httpResp(200, { received: true, ignored: 'not_payment' });

    // Recupero PI + idempotenza
    const piId = String(session.payment_intent || '');
    if (!piId) return httpResp(400, { error: 'missing payment_intent' });

    let pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.colpamiaCredited === 'true') {
      return httpResp(200, { ok: true, already: true });
    }

    // Email cliente
    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return httpResp(400, { error: 'missing email' });

    // Quanti minuti?
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ['data.price.product'] });
    let minutes = 0;
    let productTag = '';
    for (const li of items.data) {
      const priceId = li?.price?.id;
      const rule = PRICE_RULES[priceId] || {};
      const add = Number(rule.minutes || 0) * (li.quantity || 1);
      minutes += Number.isFinite(add) ? add : 0;
      if (!productTag && rule.excuse) productTag = rule.excuse;
    }
    if (minutes <= 0) return httpResp(200, { ok: true, ignored: 'no_minutes' });

    // Contesto (campo custom 'need' della sessione, se presente)
    let context = '';
    const customFields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
    for (const cf of customFields) {
      if (cf?.key?.toLowerCase() === 'need' && cf?.text?.value) context = String(cf.text.value || '').trim();
    }

    // Testo scusa (3 varianti) + versione breve per WhatsApp
    const excuses = buildExcuses(context, productTag);

    // Accredito minuti nel tuo sistema (se hai aggancio)
    await creditMinutes(email, minutes, { session_id: session.id, payment_intent: piId });

    // Email sempre
    await sendEmail(email, minutes, excuses);

    // WhatsApp: prova a recuperare un telefono affidabile e invia la variante breve
    const phoneCandidates = extractPhoneCandidates(session, pi);
    if (phoneCandidates.length) {
      const waText = `${excuses.short}\n\n(+${minutes} min accreditati su COLPA MIA)`;
      // tenta in ordine, al primo che passa si ferma
      for (const raw of phoneCandidates) {
        const res = await sendWhatsApp(raw, waText, piId);
        if (res.ok) break;
      }
    }

    // Segna idempotenza sui metadata del PI
    pi = await stripe.paymentIntents.update(piId, {
      metadata: {
        ...(pi.metadata || {}),
        colpamiaCredited: 'true',
        colpamiaEmailSent: 'true',
        colpamiaWhatsAppTried: String(!!phoneCandidates.length)
      }
    });

    return httpResp(200, { ok: true, minutes, email, waTried: !!phoneCandidates.length });
  } catch (err) {
    return httpResp(500, { error: err?.message || 'webhook_error' });
  }
};

