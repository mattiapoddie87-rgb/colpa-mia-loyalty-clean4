// Webhook Stripe: accredito wallet idempotente + invio email (non bloccante)
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const { creditMinutes } = require('./_wallet-lib');
const { sendCheckoutEmail } = require('./session-email');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Stripe-Signature'
};
const ok = (b)=>({ statusCode:200, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b||{}) });
const no = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b||{}) });

// minuti per SKU e fallback per contesto
const MINUTES_BY_SKU = {
  SCUSA_BASE: 50,
  SCUSA_DELUXE: 80,
  TRAFFICO: 20,
  RIUNIONE: 20,
  CONNESSIONE: 20,
};
const MINUTES_BY_CTX = {
  CALCETTO: 10, CENA: 5, APERITIVO: 5, EVENTO: 5, LAVORO: 5,
  FAMIGLIA: 5, SALUTE: 5, APPUNTAMENTO: 5, ESAME: 5
};

function norm(s){ return String(s||'').trim(); }
function upper(s){ return norm(s).toUpperCase(); }
function resolveEmail(s){ return s?.customer_details?.email || s?.customer_email || null; }

function resolveSKU(session){
  return upper(session?.metadata?.sku || session?.client_reference_id || '');
}

function resolveContext(session){
  const h =
    session?.metadata?.context_hint ||
    session?.metadata?.context ||
    '';
  return upper(h);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return no(405,{error:'method_not_allowed'});
  if (!endpointSecret) return no(500,{error:'missing_webhook_secret'});

  let evt;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body||'', 'base64')
      : Buffer.from(event.body||'', 'utf8');
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    evt = stripe.webhooks.constructEvent(raw, sig, endpointSecret);
  } catch (e) {
    return no(400,{ error:'invalid_signature', detail:String(e.message||e) });
  }

  if (evt.type !== 'checkout.session.completed') return ok({ignored:true});

  const session = evt.data.object;
  if (session?.payment_status !== 'paid') return ok({ignored:'unpaid'});

  // 1) Accredito wallet prima di tutto, idempotente
  try {
    const email = resolveEmail(session);
    const sku = resolveSKU(session);
    const ctx = resolveContext(session);

    let minutes = 0;
    if (MINUTES_BY_SKU[sku] != null) {
      minutes = MINUTES_BY_SKU[sku];
    } else if (MINUTES_BY_CTX[ctx] != null) {
      minutes = MINUTES_BY_CTX[ctx];
    } else {
      minutes = MINUTES_BY_SKU.SCUSA_BASE; // fallback
    }

    if (email && minutes > 0) {
      await creditMinutes({
        email,
        minutes,
        reason: `purchase_${sku||ctx||'UNK'}`,
        meta: { session_id: session.id, sku, ctx },
        txKey: `evt:${evt.id}` // idempotenza per retry Stripe
      });
    }
  } catch (e) {
    // log solo: non bloccare la 200 a Stripe
    console.error('wallet_credit_error', e.message);
  }

  // 2) Invio email non bloccante
  try { await sendCheckoutEmail({ session }); }
  catch (e) { console.error('email_send_error', e.message); }

  return ok({received:true});
};
