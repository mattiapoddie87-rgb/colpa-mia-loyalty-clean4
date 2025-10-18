// Usa ENV esistenti:
//  - PRICE_BY_SKU_JSON  -> {"SCUSA_BASE":"price_...","SCUSA_DELUXE":"price_...","CONNESSIONE":"price_...","TRAFFICO":"price_...","RIUNIONE":"price_...","COLPA_LIGHT":"price_...","COLPA_FULL":"price_...","COLPA_DELUXE":"price_..."}
//  - PRICE_RULES_JSON   -> {"SCUSA_BASE":{"excuse":"base","minutes":10}, ...}
//  - STRIPE_SECRET_KEY  -> obbligatoria
//  - SITE_URL           -> opzionale (fallback https://colpamia.com)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const j = (s,b)=>({statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b)});

function parseEnvJSON(name){
  const raw = process.env[name];
  if(!raw) return {};
  try{ return JSON.parse(raw); } catch{ return {}; }
}

const PRICE_BY_SKU = parseEnvJSON('PRICE_BY_SKU_JSON'); // sku -> price_id
const PRICE_RULES  = parseEnvJSON('PRICE_RULES_JSON');  // sku -> meta (excuse, minutes)

exports.handler = async (event) => {
  if(event.httpMethod === 'OPTIONS') return j(204,{});
  if(event.httpMethod !== 'POST')    return j(405,{error:'Method not allowed'});

  if(!process.env.STRIPE_SECRET_KEY)        return j(500,{error:'STRIPE_SECRET_KEY mancante'});
  if(!Object.keys(PRICE_BY_SKU).length)     return j(500,{error:'PRICE_BY_SKU_JSON mancante o invalido'});

  try{
    const { sku, email, title, context } = JSON.parse(event.body || '{}');
    if(!sku || !email) return j(400,{error:'sku ed email sono obbligatori'});

    const priceId = PRICE_BY_SKU[sku];
    if(!priceId) return j(400,{error:`SKU non mappato: ${sku}`});

    const rules  = PRICE_RULES[sku] || {};
    const origin = event.headers.origin || process.env.SITE_URL || 'https://colpamia.com';

    // Stripe REST
    const form = new URLSearchParams();
    form.append('mode','payment');
    form.append('success_url', `${origin}/?ok=1`);
    form.append('cancel_url',  `${origin}/checkout.html?canceled=1`);
    form.append('customer_email', email);
    form.append('line_items[0][price]', priceId);
    form.append('line_items[0][quantity]','1');

    // metadata utili per fulfillment
    if(title)   form.append('metadata[title]', title);
    if(context) form.append('metadata[context]', context);
    form.append('metadata[sku]', sku);
    if(rules.excuse)  form.append('metadata[excuse]', String(rules.excuse));
    if(rules.minutes) form.append('metadata[minutes]', String(rules.minutes));

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    const data = await resp.json();
    if(!resp.ok) return j(resp.status, {error: data.error?.message || 'Stripe error'});

    return j(200, { url: data.url });
  }catch(e){
    return j(500,{error:e.message});
  }
};
