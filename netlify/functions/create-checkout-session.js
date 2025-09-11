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

    // mappa prezzi da env
    const map = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
    const priceId = map[sku];
    if(!priceId) return json(400,{error:'unknown_sku'});

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: sku,
      success_url: success_url || 'https://colpamia.com/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancel_url  || 'https://colpamia.com/cancel.html',
      metadata: { context_hint: (context_hint || '').slice(0,120) },
      phone_number_collection: { enabled: true },
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      custom_fields: [{
        key: 'need',
        type: 'text',
        optional: false,
        label: { type:'custom', custom:'Contesto (obbligatorio: 4–120 caratteri)' },
        text: {
          default_value: (need_default || '').slice(0,120),
          minimum_length: 4,
          maximum_length: 120
        }
      }]
    });

    return json(200, { id: session.id, url: session.url });
  }catch(e){
    return json(500,{error:'create_failed', detail:String(e.message||e)});
  }
};
