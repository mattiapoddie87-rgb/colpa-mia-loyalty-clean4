// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { creditMinutes } = require('./_wallet-lib');
const { sendSessionEmail } = require('./session-email'); // lascia com'è se già importi

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Stripe-Signature'
};
const ok = (b)=>({ statusCode:200, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b||{}) });
const no = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b||{}) });

// mappa minuti per pacchetto
const SKU_MIN = {
  SCUSA_BASE: 50,
  SCUSA_DELUXE: 80,
  TRAFFICO: 20,
  RIUNIONE: 20,
  CONNESSIONE: 20,
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return no(405,{error:'method_not_allowed'});

  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whsec) return no(500,{error:'missing_webhook_secret'});

  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body||'', 'base64') : Buffer.from(event.body||'', 'utf8');
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    const evt = stripe.webhooks.constructEvent(raw, sig, whsec);

    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object;

      // email cliente
      const email =
        s?.customer_details?.email ||
        s?.customer_email ||
        s?.metadata?.email ||
        null;

      // sku
      const sku =
        s?.metadata?.sku ||
        s?.client_reference_id ||
        '';

      // accredito minuti (anche se amount_total = 0 con coupon, purché sia paid)
      if (email && sku && s?.payment_status === 'paid') {
        const minutes = SKU_MIN[String(sku).toUpperCase()] || 0;
        if (minutes > 0) {
          await creditMinutes({
            email,
            minutes,
            reason: `purchase_${sku}`,
            meta: { session_id: s.id, amount_total: s.amount_total },
            txKey: `evt:${evt.id}` // idempotenza
          });
        }
      }

      // email di conferma già esistente
      try { await sendSessionEmail(s); } catch(e) { /* non bloccare il webhook */ }
    }

    return ok({ received:true });
  } catch (e) {
    return no(400,{ error:'webhook_error', detail:String(e.message||e) });
  }
};
