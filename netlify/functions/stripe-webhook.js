// netlify/functions/stripe-webhook.js
/**
 * Webhook Stripe:
 * - checkout.session.completed -> invia email (via Resend) e accredita wallet
 * - Per COLPA_* nessuna scusa automatica: solo conferma + wallet (se previsto = 0)
 *
 * Env richieste:
 *  - STRIPE_SECRET_KEY
 *  - STRIPE_WEBHOOK_SECRET
 *  - RESEND_API_KEY
 *  - PRICE_BY_SKU_JSON          es: {"SCUSA_BASE":"price_xxx", ...}
 *  - PRICE_RULES_JSON           es: {"SCUSA_BASE":{"excuse":"base","minutes":10}, ...}
 *  - URL                        (Netlify) per chiamare /.netlify/functions/ai-excuse
 */

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// CORS util (non necessario qui, ma comodo se serve testare in locale)
const ok = body => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || { ok: true }) });
const err = (s, e) => ({ statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(e) }) });

// --- helpers ---------------------------------------------------------------

function parseJsonEnv(name, def = {}) {
  try { return JSON.parse(process.env[name] || ''); } catch { return def; }
}

const PRICE_BY_SKU = parseJsonEnv('PRICE_BY_SKU_JSON', {});
const PRICE_RULES   = parseJsonEnv('PRICE_RULES_JSON', {});

// recupera "need" (contesto) dal Checkout Session
function getContextFromSession(sess) {
  let ctx = (sess?.metadata?.context_hint || '').trim();
  const cf = Array.isArray(sess?.custom_fields) ? sess.custom_fields : [];
  const f = cf.find(x => x.key === 'need');
  const v = f?.text?.value;
  if (v && String(v).trim()) ctx = String(v).trim();
  return ctx.slice(0, 120);
}

const TITLES = {
  SCUSA_BASE: 'Scusa Base',
  SCUSA_DELUXE: 'Scusa Deluxe',
  CONNESSIONE: 'Connessione KO',
  TRAFFICO: 'Traffico',
  RIUNIONE: 'Riunione Improvvisa',
  COLPA_LIGHT: 'Prendo io la colpa — Light',
  COLPA_FULL: 'Prendo io la colpa — Full',
  COLPA_DELUXE: 'Prendo io la colpa — Deluxe'
};

// chiama la tua funzione ai-excuse (se disponibile)
async function generateExcuse(kind, context) {
  const endpoint = process.env.URL ? `${process.env.URL}/.netlify/functions/ai-excuse` : null;
  if (!endpoint) return { variants: [] };

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, context })
    });
    const j = await r.json().catch(() => ({}));
    // ai-excuse restituisce {variant} o {variants}
    if (Array.isArray(j.variants) && j.variants.length) return { variants: j.variants };
    if (j.variant) return { variants: [j.variant] };
  } catch {}
  return { variants: [] };
}

// wallet con Netlify Blobs
async function walletAddMinutes(email, delta, meta) {
  if (!email || !delta) return null;
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('wallet');
    const key = email.toLowerCase();
    const data = await store.get(key, { type: 'json' }) || { minutes: 0, history: [] };
    data.minutes = (data.minutes || 0) + Number(delta || 0);
    data.history = [{ ts: Date.now(), delta: Number(delta || 0), ...meta }, ...(data.history || [])].slice(0, 100);
    await store.set(key, JSON.stringify(data), { access: 'private' });
    return data.minutes;
  } catch {
    return null;
  }
}

function emailHtmlForManual(title, minutes, replyEmail) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
      <h2>${title}</h2>
      <p>Grazie per l’acquisto. <b>Questa tipologia è gestita personalmente</b>: nessuna scusa automatica è stata inviata.</p>
      <p>Rispondi a questa email oppure scrivi a <a href="mailto:${replyEmail}">${replyEmail}</a>
         con <b>tutti i dettagli</b> (contesto, obiettivo, dati della persona da contattare, orari utili, ecc.).</p>
      ${minutes ? `<p>Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>` : ''}
      <p>Ti rispondiamo a breve.</p>
    </div>
  `;
}

function emailHtmlForExcuse(title, variants, minutes) {
  // variants: array di frasi (1 per base, 3 per deluxe, ecc.)
  const items = variants.map((t, i) => `<li>${t}</li>`).join('');
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
      <h2>${title}</h2>
      <ol>${items}</ol>
      ${minutes ? `<p>Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>` : ''}
      <p style="color:#667085;font-size:12px">Se non vedi l’email correttamente, controlla anche in spam/promozioni.</p>
    </div>
  `;
}

// invio email (Resend) con FROM firmato + Reply-To Proton
async function sendMail({ to, subject, html }) {
  return resend.emails.send({
    from: 'COLPA MIA <no-reply@colpamia.com>',            // FROM firmato (DKIM)
    to,
    reply_to: 'colpamiaconsulenze@proton.me',              // Reply-To corretto
    subject,
    html,
    headers: { 'List-Unsubscribe': '<mailto:colpamiaconsulenze@proton.me>' }
  });
}

// --- handler ----------------------------------------------------------------

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return err(400, 'invalid_signature');
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    // Ignora altri eventi
    return ok({ received: true });
  }

  const session = stripeEvent.data.object;

  // Dati principali
  const sku = session.client_reference_id || session.metadata?.sku || '';
  const title = TITLES[sku] || sku || 'Prodotto';
  const email = session.customer_details?.email || null;

  // Regola di accredito
  const rule = PRICE_RULES[sku] || {};
  const minutesToCredit = Number(rule.minutes || 0);
  const kind = String(rule.excuse || '').toLowerCase();   // base | deluxe | conn | traffico | riunione | manuale

  // Contesto (dal checkout)
  const context = getContextFromSession(session);

  // Accredito wallet
  let walletAfter = null;
  if (email && minutesToCredit > 0) {
    walletAfter = await walletAddMinutes(email, minutesToCredit, {
      sku, session_id: session.id
    });
  }

  // Per i pacchetti "prendo io la colpa" -> nessuna scusa automatica
  const isManual = sku === 'COLPA_LIGHT' || sku === 'COLPA_FULL' || sku === 'COLPA_DELUXE';

  // Generazione scusa (se non manuale)
  let variants = [];
  if (!isManual) {
    const ai = await generateExcuse(kind || 'base', context);
    variants = Array.isArray(ai.variants) && ai.variants.length ? ai.variants : [];
    // fallback in caso di AI down
    if (!variants.length) {
      if (kind === 'deluxe') {
        variants = [
          'Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.',
          'Ti scrivo appena ho orari aggiornati così non ti lascio in sospeso.',
          'Preferisco darti orari aggiornati tra poco, appena rientro in carreggiata.'
        ];
      } else {
        variants = [
          'Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.'
        ];
      }
    }
  }

  // Composizione email
  let html, subject;
  if (isManual) {
    subject = `${title} — Presa in carico`;
    html = emailHtmlForManual(title, minutesToCredit, 'colpamiaconsulenze@proton.me');
  } else {
    subject = 'La tua Scusa — COLPA MIA';
    html = emailHtmlForExcuse(title, variants, minutesToCredit);
  }

  // Invio email (se c'è email)
  if (email) {
    try { await sendMail({ to: email, subject, html }); }
    catch (e) { /* non blocco il webhook */ }
  }

  return ok({
    ok: true,
    sku,
    title,
    credited: minutesToCredit,
    wallet_after: walletAfter,
    kind,
    context_used: context
  });
};
