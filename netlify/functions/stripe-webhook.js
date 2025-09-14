// Webhook Stripe: invia email e accreditare minuti wallet per email cliente
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const { sendCheckoutEmail } = require('./session-email');
const { creditMinutes } = require('./_wallet-lib.js');

// ---- mapping minuti configurabile via ENV ----
function loadMinutesMap() {
  try { return JSON.parse(process.env.WALLET_MINUTES_JSON || '{}'); } catch { return {}; }
}
const MIN_MAP = Object.assign({
  CALCETTO: 10,
  CENA: 5,
  APERITIVO: 5,
  EVENTO: 5,
  LAVORO: 5,
  FAMIGLIA: 5,
  SALUTE: 5,
  APPUNTAMENTO: 5,
  ESAME: 5,
  TRAFFICO: 5,
  RIUNIONE: 5,
  CONNESSIONE: 5,
  SCUSA_BASE: 5,
  SCUSA_DELUXE: 15
}, loadMinutesMap());

const CTX_PAT = {
  CALCETTO: /(calcett|partita|calcetto)/i,
  TRAFFICO: /(traffico|coda|incidente|blocco)/i,
  RIUNIONE: /(riunion|meeting)/i,
  CONNESSIONE: /(connession|internet|rete|wifi)/i,
  CENA: /(cena|ristor)/i,
  APERITIVO: /(aper|spritz|drink)/i,
  EVENTO: /(evento|party|festa|concerto)/i,
  LAVORO: /(lavor|ufficio|report)/i,
  FAMIGLIA: /(famigl|figli|marit|mogli|genit|madre|padre|nonna|nonno)/i,
  SALUTE: /(salute|febbre|medic|dott|tosse|allerg)/i,
  APPUNTAMENTO: /(appunt|conseg)/i,
  ESAME: /(esame|lezion|prof)/i
};

function arr(x){ return Array.isArray(x) ? x : (x && x.data ? x.data : []); }
function looksDeluxeText(s){ return /\bDELUXE\b/i.test(String(s||'')); }
function resolveEmail(session){ return session?.customer_details?.email || session?.customer_email || null; }

function extractHints(session, lineItems){
  const hints = [];
  const push = v => { if (v) hints.push(String(v)); };
  push(session?.client_reference_id);
  push(session?.metadata?.sku);
  push(session?.metadata?.category);
  const items = arr(lineItems);
  for (const it of items){
    push(it?.description);
    push(it?.price?.nickname);
    push(it?.price?.product?.name);
    push(it?.price?.metadata?.sku);
    push(it?.price?.product?.metadata?.sku);
  }
  // include need testo
  const cf = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  const f = cf.find(x=>x?.key==='need' && x?.type==='text' && x?.text?.value);
  if (f?.text?.value) push(f.text.value);
  return hints.filter(Boolean);
}

function resolveContext(session, lineItems){
  const hints = extractHints(session, lineItems);
  // match diretto su chiave modello o su SCUSA_<CHIAVE>
  for (const h of hints){
    const U = h.toUpperCase();
    for (const ctx of Object.keys(CTX_PAT)){
      if (U.includes(ctx) || U.includes(`SCUSA_${ctx}`)) return ctx;
    }
  }
  // pattern
  for (const h of hints){
    for (const [ctx, rx] of Object.entries(CTX_PAT)){ if (rx.test(h)) return ctx; }
  }
  return 'SCUSA_BASE';
}

async function listLineItemsSafe(sessionId){
  try {
    const li = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 50 });
    return li;
  } catch { return { data: [] }; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, endpointSecret);
  } catch (err) {
    console.error('Firma Stripe non valida:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object;
    if (session.payment_status !== 'paid') return { statusCode: 200, body: 'ignored_unpaid' };

    // line items e contesto
    const lineItems = await listLineItemsSafe(session.id);
    const ctx = resolveContext(session, lineItems);
    const isDeluxe = looksDeluxeText(session?.metadata?.sku) ||
                     looksDeluxeText(session?.client_reference_id) ||
                     arr(lineItems).some(it => looksDeluxeText(it?.description) || looksDeluxeText(it?.price?.nickname) || looksDeluxeText(it?.price?.product?.name));

    // invio email
    try { await sendCheckoutEmail({ session, lineItems }); }
    catch (e) { console.error('Invio email fallito:', e.message); return { statusCode: 500, body: 'email_send_failed' }; }

    // accredito minuti wallet (idempotente su event.id)
    const email = resolveEmail(session);
    if (email) {
      // minuti: mappa specifica > deluxe > default
      let minutes = MIN_MAP[ctx] ?? MIN_MAP.SCUSA_BASE;
      if (isDeluxe) minutes = Math.max(minutes, MIN_MAP.SCUSA_DELUXE || 15);
      try {
        await creditMinutes({
          email,
          minutes,
          reason: 'checkout',
          meta: { ctx, sessionId: session.id, eventId: evt.id },
          txKey: `stripe:${evt.id}`
        });
        console.log('wallet_credit', { email, minutes, ctx, deluxe: isDeluxe });
      } catch (e) {
        console.error('wallet_credit_failed', e.message);
        // non blocco l’OK a Stripe per non generare retry su accredito
      }
    } else {
      console.warn('wallet_skip_email_missing', { sessionId: session.id });
    }
  }

  return { statusCode: 200, body: 'ok' };
};
