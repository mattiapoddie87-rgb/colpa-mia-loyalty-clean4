// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/,'');
function up(x){ return String(x||'').toUpperCase(); }

function priceFromEnvBySku(sku){
  try{
    const map = JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
    return map[sku] || null;
  }catch{ return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error:'method_not_allowed' }) };
  }

  let body={};
  try{ body = JSON.parse(event.body||'{}'); }catch{
    return { statusCode: 400, body: JSON.stringify({ error:'bad_json' }) };
  }

  const skuRaw = body.sku;
  if (!skuRaw) return { statusCode: 400, body: JSON.stringify({ error:'missing_sku' }) };
  const SKU = up(skuRaw);
  const isColpa = SKU.startsWith('COLPA_');

  // Price: preferisci PRICE_BY_SKU_JSON (più sicuro). Se non presente, consenti price_id dal client.
  let priceId = body.price_id || priceFromEnvBySku(SKU);
  if (!priceId) return { statusCode: 400, body: JSON.stringify({ error:'missing_price_for_sku', sku:SKU }) };

  // Custom fields: telefono sempre opzionale
  const custom_fields = [{
    key:'phone',
    label:{ type:'custom', custom:'Telefono WhatsApp (opz.)' },
    type:'text',
    optional:true
  }];

  // Solo per Base/Deluxe aggiungiamo "Contesto"
  if (['SCUSA_BASE','SCUSA_DELUXE'].includes(SKU)) {
    const needLabel   = String(body.need_label||'Contesto (obbligatorio: 4–120 caratteri)');
    const needDefault = String(body.need_default||'').slice(0,120);
    custom_fields.push({
      key:'need',
      label:{ type:'custom', custom: needLabel },
      type:'text',
      optional:false,
      text:{ default_value: needDefault }
    });
  }

  // success_url
  const successUrl = new URL(body.success_url || (SITE_URL + '/success.html'));
  successUrl.searchParams.set('sku', SKU);
  if (isColpa) successUrl.searchParams.set('openMail','1');

  try{
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      allow_promotion_codes: true,
      client_reference_id: SKU,
      success_url: successUrl.toString() + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: body.cancel_url || (SITE_URL + '/cancel.html'),
      line_items: [{ price: priceId, quantity: 1 }],
      custom_fields,
      phone_number_collection: { enabled:true },
      metadata: { sku: SKU }
    });

    return { statusCode: 200, body: JSON.stringify({ id: session.id, url: session.url }) };
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ error:'stripe_create_failed', detail:String(err?.message||err) }) };
  }
};
