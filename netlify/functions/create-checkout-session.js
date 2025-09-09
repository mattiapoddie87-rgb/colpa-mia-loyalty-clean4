// netlify/functions/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

const ALLOWED_SKU = new Set(['SCUSA_ENTRY','SCUSA_BASE','SCUSA_TRIPLA','SCUSA_DELUXE','CONS_KO','RIUNIONE','TRAFFICO']);
const PRICE_BY_SKU = (()=>{ try{return JSON.parse(process.env.PRICE_BY_SKU_JSON||'{}');}catch{return{}}; })();

const ORIGIN = e => process.env.SITE_URL || `${(e.headers['x-forwarded-proto']||'https')}://${(e.headers['x-forwarded-host']||e.headers.host)}`;

const NEED_REQUIRED = new Set(['SCUSA_BASE','SCUSA_TRIPLA','SCUSA_DELUXE']);       // deve chiedere contesto
const NEED_NOT_NEEDED = new Set(['RIUNIONE','TRAFFICO','CONS_KO']);               // non chiedere contesto

exports.handler = async (event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  if(event.httpMethod!=='POST')    return j(405,{error:'method_not_allowed'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }
  const sku = String(body.sku||'').toUpperCase();
  if(!sku || !ALLOWED_SKU.has(sku)) return j(400,{error:'invalid_sku'});

  // risolvi price
  let price = PRICE_BY_SKU[sku] || null;
  if(!price){
    try{ const r=await stripe.prices.list({lookup_keys:[sku],active:true,limit:1}); price=r?.data?.[0]?.id||null; }catch{}
  }
  if(!price) return j(400,{error:`price_not_found_for_sku:${sku}`});

  // custom fields dinamici
  const custom_fields = [
    {
      key:'phone',
      label:{type:'custom',custom:'Telefono WhatsApp (opz.)'},
      type:'text',
      optional:true
    }
  ];
  if (NEED_REQUIRED.has(sku)) {
    custom_fields.push({
      key:'need',
      label:{type:'custom', custom:'Contesto (obbligatorio: 4–120 caratteri)'},
      type:'text',
      optional:false
    });
  }
  // per NEED_NOT_NEEDED non aggiungiamo il campo "need"

  try{
    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      line_items:[{price,quantity:1}],
      allow_promotion_codes:true,
      customer_creation:'always',
      phone_number_collection:{enabled:true},
      custom_fields,
      client_reference_id: sku,
      metadata:{ sku },
      success_url: `${ORIGIN(event)}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${ORIGIN(event)}/cancel.html?sku=${encodeURIComponent(sku)}`
    });
    return j(200,{url:session.url});
  }catch(err){
    return j(500,{error:String(err?.message||'stripe_error')});
  }
};
