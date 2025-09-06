// netlify/functions/create-checkout-session.js
// Abilita il campo "codice promo" in Checkout e supporta l'auto-apply opzionale.
// ENV richieste: STRIPE_SECRET_KEY
// Opz.: PRICE_BY_SKU_JSON { "SCUSA_BASE": "price_xxx", ... } (altrimenti usa lookup_key = SKU)

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });
const origin = (e)=> process.env.SITE_URL || `${(e.headers['x-forwarded-proto']||'https')}://${(e.headers['x-forwarded-host']||e.headers.host)}`;

const ALLOWED = new Set(['SCUSA_ENTRY','SCUSA_BASE','SCUSA_TRIPLA','SCUSA_DELUXE','CONS_KO','RIUNIONE','TRAFFICO']);
function readJsonEnv(k){ try{ return JSON.parse(process.env[k]||'{}'); }catch{ return {}; } }
const PRICE_BY_SKU = readJsonEnv('PRICE_BY_SKU_JSON'); // { SKU: price_id }

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{ error:'bad_json' }); }
  const sku = String(body.sku||'').trim().toUpperCase();
  if (!ALLOWED.has(sku)) return j(400,{ error:`price_not_found_for_sku:${sku}` });

  // opzionale: auto-applica un promotion code passato dal frontend (es. FREE100)
  const promo = String(body.promo||'').trim();

  // 1) price da ENV o 2) lookup_key
  let priceId = PRICE_BY_SKU[sku];
  if (!priceId) {
    const r = await stripe.prices.list({ lookup_keys:[sku], active:true, limit:1 });
    priceId = r?.data?.[0]?.id || null;
  }
  if (!priceId) return j(400,{ error:`price_not_found_for_sku:${sku}` });

  try{
    const params = {
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin(event)}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin(event)}/cancel.html?sku=${encodeURIComponent(sku)}`,

      // ✅ qui abiliti il campo "Inserisci codice promo" nella pagina Stripe
      allow_promotion_codes: true,

      customer_creation: 'always',
      phone_number_collection: { enabled: true },
      custom_fields: [
        { key:'need',  label:{type:'custom',custom:'Contesto (opz.)'},        type:'text', optional:true },
        { key:'phone', label:{type:'custom',custom:'Telefono WhatsApp (opz.)'}, type:'text', optional:true },
      ],
      metadata: { sku }
    };

    // Se dal frontend passi body.promo (es. "FREE100"), proviamo ad auto-applicarlo
    if (promo) {
      params.discounts = [{ promotion_code: promo }];
      // NB: il valore deve essere l'ID del promotion code, NON il testo; se vuoi passare il codice testuale,
      // risolvi prima l'ID con: const pc = await stripe.promotionCodes.list({ code: promo, active:true, limit:1 })
      // e usa pc.data[0].id
    }

    const s = await stripe.checkout.sessions.create(params);
    return j(200,{ url: s.url });
  }catch(err){
    return j(500,{ error:String(err?.message||'stripe_error') });
  }
};

