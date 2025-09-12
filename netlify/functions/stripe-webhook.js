// netlify/functions/stripe-webhook.js
/**
 * Webhook Stripe completo e robusto.
 * - checkout.session.completed: invia email + accredita wallet
 * - Per COLPA_* nessuna scusa automatica
 */

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const ok  = (b={ok:true}) => ({ statusCode:200, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) });
const err = (s,e)        => ({ statusCode:s,   headers:{'Content-Type':'application/json'}, body:JSON.stringify({error:String(e)}) });

function parseJsonEnv(name, def={}) {
  try { return JSON.parse(process.env[name] || ''); } catch { return def; }
}
const PRICE_BY_SKU = parseJsonEnv('PRICE_BY_SKU_JSON', {});
const PRICE_RULES  = parseJsonEnv('PRICE_RULES_JSON', {});

/* Title user-friendly */
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

/* Inversione mappa price->sku per fallback */
const PRICE_TO_SKU = Object.fromEntries(Object.entries(PRICE_BY_SKU).map(([sku, price]) => [price, sku]));

/* Email helper */
async function sendMail({ to, subject, html }) {
  return resend.emails.send({
    from: 'COLPA MIA <no-reply@colpamia.com>',           // dominio firmato
    to,
    reply_to: 'colpamiaconsulenze@proton.me',
    subject,
    html,
    headers: { 'List-Unsubscribe': '<mailto:colpamiaconsulenze@proton.me>' }
  });
}

/* Wallet via Netlify Blobs */
async function walletAddMinutes(email, delta, meta) {
  if (!email || !delta) return null;
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('wallet');
    const key = email.toLowerCase();
    const data = await store.get(key, { type: 'json' }) || { minutes: 0, history: [] };
    data.minutes = (data.minutes || 0) + Number(delta || 0);
    data.history = [{ ts: Date.now(), delta: Number(delta||0), ...meta }, ...(data.history||[])].slice(0, 100);
    await store.set(key, JSON.stringify(data), { access: 'private' });
    return data.minutes;
  } catch {
    return null;
  }
}

/* Html mail */
function htmlManual(title, minutes) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
    <h2>${title}</h2>
    <p><b>Nessuna scusa automatica inviata</b>: questa tipologia è gestita manualmente.</p>
    <p>Rispondi a questa email oppure scrivi a
      <a href="mailto:colpamiaconsulenze@proton.me">colpamiaconsulenze@proton.me</a>
      con <b>tutti i dettagli</b> (contesto, obiettivo, dati della persona da contattare, orari utili, ecc.).</p>
    ${minutes ? `<p>Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>` : ''}
  </div>`;
}

function htmlExcuse(title, variants, minutes) {
  const items = variants.map((t,i)=>`<li>${t}</li>`).join('');
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
    <h2>${title}</h2>
    <ol>${items}</ol>
    ${minutes ? `<p>Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>` : ''}
    <p style="color:#667085;font-size:12px">Se non trovi il messaggio, controlla anche spam/promozioni.</p>
  </div>`;
}

/* Contesto dal session */
function getContextFromSession(sess) {
  let ctx = (sess?.metadata?.context_hint || '').trim();
  const cf = Array.isArray(sess?.custom_fields) ? sess.custom_fields : [];
  const f = cf.find(x => x.key === 'need');
  const v = f?.text?.value;
  if (v && String(v).trim()) ctx = String(v).trim();
  return ctx.slice(0, 120);
}

/* AI (se c’è), con fallback */
async function aiVariants(kind, context) {
  const endpoint = process.env.URL ? `${process.env.URL}/.netlify/functions/ai-excuse` : null;
  if (endpoint) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ kind, context })
      });
      const j = await r.json().catch(()=> ({}));
      if (Array.isArray(j.variants) && j.variants.length) return j.variants;
      if (j.variant) return [j.variant];
    } catch {}
  }
  // fallback sobrio
  if (kind === 'deluxe') {
    return [
      'Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.',
      'Appena ho orari aggiornati ti scrivo così non ti lascio in sospeso.',
      'Preferisco darti orari aggiornati tra poco, appena rientro in carreggiata.'
    ];
  }
  return ['Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.'];
}

/* Determina SKU con fallback (client_reference_id -> metadata -> price map) */
function detectSku(session, fullSession) {
  if (session?.client_reference_id) return session.client_reference_id;
  if (session?.metadata?.sku) return session.metadata.sku;

  const li = fullSession?.line_items?.data?.[0];
  const priceId = li?.price?.id;
  if (priceId && PRICE_TO_SKU[priceId]) return PRICE_TO_SKU[priceId];

  return '';
}

/* Handler */
exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let evt;
  try {
    evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return err(400, 'invalid_signature');
  }

  if (evt.type !== 'checkout.session.completed') return ok({ ignored: true });

  const sess = evt.data.object;

  // Recupero sessione completa per sicurezza (line_items + eventuali campi)
  let full = null;
  try {
    full = await stripe.checkout.sessions.retrieve(sess.id, { expand: ['line_items'] });
  } catch { full = sess; }

  // Dati fondamentali
  const email = full?.customer_details?.email || sess?.customer_details?.email || null;
  const sku   = detectSku(sess, full);
  const title = TITLES[sku] || sku || 'Prodotto';

  // Regola per minuti / kind
  const rule   = PRICE_RULES[sku] || {};
  const minutesToCredit = Number(rule.minutes || 0);
  const kind   = String(rule.excuse || '').toLowerCase();  // base|deluxe|conn|traffico|riunione|...

  // Contesto
  const context = getContextFromSession(full || sess);

  // Accredito wallet
  let walletAfter = null;
  if (email && minutesToCredit > 0) {
    walletAfter = await walletAddMinutes(email, minutesToCredit, { sku, session_id: sess.id });
  }

  // Pacchetti manuali: nessuna scusa
  const isManual = ['COLPA_LIGHT','COLPA_FULL','COLPA_DELUXE'].includes(sku);

  // Email
  try {
    if (email) {
      if (isManual) {
        await sendMail({
          to: email,
          subject: `${title} — Presa in carico`,
          html: htmlManual(title, minutesToCredit)
        });
      } else {
        let variants = await aiVariants(kind || 'base', context);
        if (kind === 'base' && variants.length > 1) variants = [variants[0]]; // base = 1 sola
        await sendMail({
          to: email,
          subject: `La tua Scusa — ${title}`,
          html: htmlExcuse(title, variants, minutesToCredit)
        });
      }
    }
  } catch (e) {
    // non blocco il webhook
  }

  return ok({
    ok: true,
    session_id: sess.id,
    sku,
    title,
    email,
    credited: minutesToCredit,
    wallet_after: walletAfter,
    context_used: context
  });
};
