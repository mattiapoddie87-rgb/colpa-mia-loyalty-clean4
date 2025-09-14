// Webhook Stripe: accredito wallet idempotente + invio email
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const { creditMinutes } = require('./_wallet-lib');   // senza .js per bundler
const { sendCheckoutEmail } = require('./session-email');

// minuti di default, sovrascrivibili via WALLET_MINUTES_JSON
function loadMinutesMap() {
  try { return JSON.parse(process.env.WALLET_MINUTES_JSON || '{}'); } catch { return {}; }
}
const BASE_MAP = {
  CALCETTO: 10, CENA: 5, APERITIVO: 5, EVENTO: 5, LAVORO: 5,
  FAMIGLIA: 5, SALUTE: 5, APPUNTAMENTO: 5, ESAME: 5,
  TRAFFICO: 5, RIUNIONE: 5, CONNESSIONE: 5,
  SCUSA_BASE: 5, SCUSA_DELUXE: 15
};
const MIN_MAP = Object.assign({}, BASE_MAP, loadMinutesMap());

// pattern per il contesto
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

const arr = x => Array.isArray(x) ? x : (x && x.data ? x.data : []);
const upper = s => String(s||'').trim().toUpperCase();

function resolveEmail(s){ return s?.customer_details?.email || s?.customer_email || null; }
function looksDeluxeText(s){ return /\bDELUXE\b/i.test(String(s||'')); }

async function listLineItemsSafe(sessionId){
  try { return await stripe.checkout.sessions.listLineItems(sessionId, { limit: 50 }); }
  catch { return { data: [] }; }
}

function extractHints(session, lineItems){
  const out = [];
  const push = v => { if (v) out.push(String(v)); };
  push(session?.client_reference_id);
  push(session?.metadata?.sku);
  push(session?.metadata?.context_hint);
  push(session?.metadata?.category);
  for (const it of arr(lineItems)){
    push(it?.description);
    push(it?.price?.nickname);
    push(it?.price?.product?.name);
    push(it?.price?.metadata?.sku);
    push(it?.price?.product?.metadata?.sku);
  }
  const cf = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  const need = cf.find(x=>x?.key==='need' && x?.type==='text' && x?.text?.value);
  if (need?.text?.value) push(need.text.value);
  return out.filter(Boolean);
}

function resolveContext(session, lineItems){
  // priorità assoluta a metadata.context_hint se già fornito dal checkout
  const hint = upper(session?.metadata?.context_hint || session?.metadata?.context || '');
  if (hint && MIN_MAP[hint] != null) return hint;

  // altrimenti deduco dai hints
  const hints = extractHints(session, lineItems);
  for (const h of hints){
    const U = upper(h);
    for (const key of Object.keys(CTX_PAT)){
      if (U.includes(key) || U.includes(`SCUSA_${key}`)) return key;
    }
  }
  for (const h of hints){
    for (const [k, rx] of Object.entries(CTX_PAT)){ if (rx.test(h)) return k; }
  }
  return 'SCUSA_BASE';
}

function resolveSKU(session, lineItems){
  const s = upper(session?.metadata?.sku || session?.client_reference_id || '');
  if (s) return s;
  // fallback da line items
  for (const it of arr(lineItems)){
    const c = upper(it?.price?.metadata?.sku || it?.price?.product?.metadata?.sku || it?.description || '');
    if (c.includes('SCUSA_DELUXE')) return 'SCUSA_DELUXE';
    if (c.includes('SCUSA_BASE')) return 'SCUSA_BASE';
  }
  return '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!endpointSecret) return { statusCode: 500, body: 'missing_webhook_secret' };

  let evt;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body||'', 'base64') : Buffer.from(event.body||'', 'utf8');
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    evt = stripe.webhooks.constructEvent(raw, sig, endpointSecret);
  } catch (err) {
    console.error('stripe_signature_invalid', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (evt.type !== 'checkout.session.completed') return { statusCode: 200, body: 'ignored' };

  const session = evt.data.object;
  if (session.payment_status !== 'paid') return { statusCode: 200, body: 'ignored_unpaid' };

  // dati utili
  const lineItems = await listLineItemsSafe(session.id);
  const sku = resolveSKU(session, lineItems);                 // es. SCUSA_BASE / SCUSA_DELUXE / TRAFFICO ...
  const ctx = resolveContext(session, lineItems);             // es. CENA / CALCETTO ...
  const isDeluxe =
    looksDeluxeText(sku) ||
    looksDeluxeText(session?.client_reference_id) ||
    arr(lineItems).some(it => looksDeluxeText(it?.description) || looksDeluxeText(it?.price?.nickname) || looksDeluxeText(it?.price?.product?.name));

  // 1) Accredito wallet PRIMA, idempotente su evt.id
  try {
    const email = resolveEmail(session);
    if (email) {
      let minutes = 0;

      // priorità: mapping per SKU se presente
      if (MIN_MAP[sku] != null) minutes = MIN_MAP[sku];
      // altrimenti deluxe/base in base al flag
      else if (isDeluxe) minutes = MIN_MAP.SCUSA_DELUXE;
      else if (MIN_MAP[ctx] != null) minutes = MIN_MAP[ctx];
      else minutes = MIN_MAP.SCUSA_BASE;

      if (minutes > 0) {
        await creditMinutes({
          email,
          minutes,
          reason: `purchase_${sku || ctx || 'UNK'}`,
          meta: {
            sessionId: session.id,
            sku, ctx,
            amount_total: session.amount_total,
            currency: session.currency
          },
          txKey: `stripe:${evt.id}`    // idempotenza contro retry di Stripe
        });
        console.log('wallet_credit_ok', { email, minutes, sku, ctx, deluxe:isDeluxe });
      } else {
        console.warn('wallet_credit_skip_zero', { sku, ctx });
      }
    } else {
      console.warn('wallet_skip_email_missing', { sessionId: session.id });
    }
  } catch (e) {
    console.error('wallet_credit_error', e.message);
    // non blocco mai la 200 verso Stripe
  }

  // 2) Invio email NON BLOCCANTE
  try { await sendCheckoutEmail({ session, lineItems }); }
  catch (e) { console.error('email_send_error', e.message); }

  return { statusCode: 200, body: 'ok' };
};
