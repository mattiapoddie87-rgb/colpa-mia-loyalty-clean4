const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = { 'Access-Control-Allow-Origin': '*' };
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')    return j(405,{ error:'method_not_allowed' });

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{ error:'bad_json' }); }

  const price_id   = String(body.price_id||'').trim();
  const sku        = String(body.sku||'').trim();
  const successUrl = String(body.success_url||'').trim();
  const cancelUrl  = String(body.cancel_url||'').trim();
  const needLabel  = String(body.need_label||'Contesto (obbligatorio: 4–120 caratteri)').slice(0,120);

  if (!price_id || !sku || !successUrl || !cancelUrl) return j(400,{ error:'missing_params' });

  try{
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'if_required',                 // evita duplicati Customer
      allow_promotion_codes: true,
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancelUrl,
      client_reference_id: sku,                         // letto dal webhook → kind
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
          label: { type:'custom', custom: needLabel },  // mostra il contesto selezionato
          type: 'text',
          optional: false
        }
      ],
      metadata: { sku }
    });

    return j(200, { id: session.id, url: session.url || null });
  }catch(e){
    return j(500, { error:'stripe_error', detail:String(e?.message||e) });
  }
};
