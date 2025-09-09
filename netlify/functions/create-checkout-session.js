// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')    return j(405,{error:'method_not_allowed'});

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  const { price_id, success_url, cancel_url, sku, need_label='Contesto (obbligatorio: 4–120 caratteri)' } = body;
  if (!price_id || !success_url || !cancel_url || !sku) return j(400,{error:'missing_params'});

  try{
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'if_required',            // <— STOP duplicati
      allow_promotion_codes: true,
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: success_url + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url,
      client_reference_id: sku,                    // usato dal webhook per mappare il “kind”
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
          label: { type:'custom', custom: need_label },
          type: 'text',
          optional: false
        }
      ],
      // facoltativo: precompila la UI se lo passi dal frontend
      // customer_email: body.prefill_email || undefined,
      metadata: { sku }
    });
    return j(200,{ id: session.id, url: session.url || null });
  }catch(e){
    return j(500,{ error:'stripe_error', detail:String(e?.message||e) });
  }
};
