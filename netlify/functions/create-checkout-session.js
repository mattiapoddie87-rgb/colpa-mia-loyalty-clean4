const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const j = (s,b,h={}) => ({ statusCode:s, headers:{'Content-Type':'application/json',...CORS,...h}, body:JSON.stringify(b) });
const origin = (e)=> process.env.SITE_URL ||
  `${(e.headers['x-forwarded-proto']||'https')}://${(e.headers['x-forwarded-host']||e.headers.host)}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }
  const sku = String(body.sku||'').trim(); if(!sku) return j(400,{error:'missing_sku'});

  // 1) mappa da ENV
  let map={}; try{ map=JSON.parse(process.env.PRICE_BY_SKU_JSON||'{}'); }catch{}
  let priceId = map[sku];

  // 2) fallback: lookup_key = sku
  if(!priceId){
    try{
      const r = await stripe.prices.list({ lookup_keys:[sku], active:true, limit:1 });
      priceId = r?.data?.[0]?.id || null;
    }catch{}
  }
  if(!priceId) return j(400,{ error:`price_not_found_for_sku:${sku}` });

  try{
    const s = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `${origin(event)}/success.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${origin(event)}/cancel.html?sku=${encodeURIComponent(sku)}`,
  allow_promotion_codes: false,
  customer_creation: 'always',
  phone_number_collection: { enabled: true },
  custom_fields: [
    { key:'phone', label:{type:'custom',custom:'Telefono WhatsApp (opz.)'}, type:'text', optional:true },
    { key:'need',  label:{type:'custom',custom:'Contesto (opz.)'},        type:'text', optional:true },
  ],
  metadata: { sku }
});

    return j(200,{ url: s.url });
  }catch(err){
    return j(500,{ error:String(err?.message||'stripe_error') });
  }
};
