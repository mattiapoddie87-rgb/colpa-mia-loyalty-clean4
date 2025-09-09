// netlify/functions/create-checkout-session.js
// Robust: valida price_id; fallback a mappa SKU→PRICE; precompila 'need'

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

// Mappa centrale (prende da ENV se presenti, altrimenti usa i tuoi ID)
const PRICE_MAP = {
  SCUSA_BASE:     (process.env.PRICE_BASE_ID     || 'price_1S1vuQAuMAjkbPdHnq3JIDQZ'),
  SCUSA_DELUXE:   (process.env.PRICE_DELUXE_ID   || 'price_1S1vuXAuMAjkbPdHmgyfY8Bj'),
  CONNESSIONE:    (process.env.PRICE_CONN_ID     || 'price_1S1w4RAuMAjkbPdHLfPElLnX'),
  TRAFFICO:       (process.env.PRICE_TRAFF_ID    || 'price_1S1wdaAuMAjkbPdH8We1FVEy'),
  RIUNIONE:       (process.env.PRICE_RIUN_ID     || 'price_1S1wdXAuMAjkbPdHfqU3fnwq'),
};

async function resolvePriceId(inputPriceId, sku){
  // 1) Se arriva un price_id, verifica che esista
  if (inputPriceId) {
    try {
      const p = await stripe.prices.retrieve(inputPriceId);
      if (p && p.active) return p.id; // ok
    } catch (_) { /* cade al fallback */ }
  }
  // 2) Fallback su mappa per SKU
  const pid = PRICE_MAP[sku];
  if (!pid) throw new Error('price_not_found_for_sku');
  // verifica anche il fallback
  const p2 = await stripe.prices.retrieve(pid);
  if (!p2 || !p2.active) throw new Error('mapped_price_inactive_or_missing');
  return p2.id;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')    return j(405,{ error:'method_not_allowed' });

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{ error:'bad_json' }); }

  const sku          = String(body.sku||'').trim();
  const price_id_in  = String(body.price_id||'').trim();
  const successUrl   = String(body.success_url||'').trim();
  const cancelUrl    = String(body.cancel_url||'').trim();
  const needLabel    = String(body.need_label||'Contesto (obbligatorio: 4–120 caratteri)').slice(0,120);
  const needDefault  = String(body.need_default||'').slice(0,120);

  if (!sku || !successUrl || !cancelUrl) return j(400,{ error:'missing_params' });

  try{
    const price_id = await resolvePriceId(price_id_in, sku);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'if_required',
      allow_promotion_codes: true,
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancelUrl,
      client_reference_id: sku,
      phone_number_collection: { enabled: true },
      custom_fields: [
        {
          key: 'phone',
          label: { type:'custom', custom:'Telefono WhatsApp (opz.)' },
          type: 'text',
          optional: true
        },
        {
          key: 'need',
          label: { type:'custom', custom: needLabel },
          type: 'text',
          optional: false,
          text: { default_value: needDefault || null, minimum_length: 4, maximum_length: 120 }
        }
      ],
      metadata: { sku }
    });

    return j(200, { id: session.id, url: session.url || null });
  }catch(e){
    // Errore esplicito per debug in console
    return j(500, {
      error: 'stripe_error',
      detail: String(e?.message||e),
      hint: 'Controlla che il PRICE appartenga allo stesso ambiente (LIVE) ed è Active.'
    });
  }
};
