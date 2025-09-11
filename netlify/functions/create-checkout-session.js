// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});

  try{
    const {
      sku,
      success_url,
      cancel_url,
      need_default = '',
      context_hint = ''
    } = JSON.parse(event.body || '{}');

    if(!sku) return json(400,{error:'missing_sku'});

    // Prezzi per SKU
    let priceMap = {};
    try { priceMap = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}'); }
    catch { return json(500,{error:'bad_PRICE_BY_SKU_JSON'}); }
    const priceId = priceMap[sku];
    if(!priceId) return json(400,{error:'unknown_sku'});

    // Regole minuti (wallet)
    let ruleMap = {};
    try { ruleMap = JSON.parse(process.env.PRICE_RULES_JSON || '{}'); }
    catch { /* opzionale */ }
    const rule = ruleMap[sku] || {};
    const minutes = Number(rule.minutes || 0);

    // Per quali SKU chiedere il contesto in Checkout
    const REQUIRE_CONTEXT = new Set(['SCUSA_BASE','SCUSA_DELUXE']);

    const customFields = REQUIRE_CONTEXT.has(sku) ? [{
      key: 'need',
      type: 'text',
      optional: false,
      label: { type:'custom', custom:'Contesto (obbligatorio)' }, // breve (<=50 char)
      text: {
        default_value: (need_default || '').slice(0,120),
        minimum_length: 4,
        maximum_length: 120
      }
    }] : [];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sku,
      success_url: success_url || 'https://colpamia.com/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancel_url  || 'https://colpamia.com/cancel.html',
      allow_promotion_codes: true,
      phone_number_collection: { enabled: true },
      customer_creation: 'always', // così abbiamo SEMPRE il customer
      line_items: [{ price: priceId, quantity: 1 }],
      ...(customFields.length ? { custom_fields: customFields } : {}),
      metadata: {
        sku,
        minutes: String(isNaN(minutes) ? 0 : minutes),
        context_hint: (context_hint || '').slice(0,120)
      }
    });

    return json(200, { id: session.id, url: session.url });
  }catch(e){
    return json(500,{error:'create_failed', detail:String(e.message||e)});
  }
};
