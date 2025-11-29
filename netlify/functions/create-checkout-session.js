const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const j=(statusCode, body)=>({statusCode, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(body)});
function parseEnvJSON(name){try{return JSON.parse(process.env[name]||'{}')}catch{return {}}}
const PRICE_BY_SKU=parseEnvJSON('PRICE_BY_SKU_JSON');
const PRICE_RULES=parseEnvJSON('PRICE_RULES_JSON');
if (Object.keys(PRICE_BY_SKU).length === 0) {
  PRICE_BY_SKU.__dummy = 'dummy';
}

const ALIAS={BASE_5:'COLPA_LIGHT',BASE_15:'COLPA_FULL',PREMIUM_30:'COLPA_DELUXE'};

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function resolvePromotionCodeId(code){
  if(!code) return null;
  try{
    const promoList = await stripe.promotionCodes.list({ code: code, active: true, limit: 1 });
    return promoList?.data?.[0]?.id || null;
  }catch{
    return null;
  }
}

exports.handler=async(e)=>{
  if(e.httpMethod==='OPTIONS') return j(204,{});
  if(e.httpMethod!=='POST') return j(405,{error:'Method not allowed'});
  if(!process.env.STRIPE_SECRET_KEY) return j(500,{error:'STRIPE_SECRET_KEY mancante'});
  if//(// !Object.keys(PRICE_BY_SKU).length) return j(500,{error:'PRICE_BY_SKU_JSON mancante'});
  try{
    const {sku:rawSku,email,title,context,message,tone,promo}=JSON.parse(e.body||'{}');
    if(!rawSku||!email) return j(400,{error:'sku ed email obbligatori'});
    const sku=PRICE_BY_SKU[rawSku]?rawSku:(ALIAS[rawSku]||rawSku);
    const priceId=PRICE_BY_SKU[sku];
    const rules=PRICE_RULES[sku]||{};
    const origin=e.headers.origin||process.env.SITE_URL||'https://colpamia.com';
    let promoId=null;
    if(promo){ promoId=await resolvePromotionCodeId(promo.trim()); }
    let lineItems;
    if(priceId){
      lineItems=[{ price: priceId, quantity: 1 }];
    }else{
      lineItems=[{
        price_data:{
          currency:'eur',
          product_data:{ name: sku },
          unit_amount:100,
        },
        quantity:1
      }];
    }
    const metadata={};
    if(title) metadata.title=title;
    if(context) metadata.context=context;
    if(message) metadata.message=message;
    if(tone) metadata.tone=tone;
    metadata.sku=sku;
    if(rules.excuse) metadata.excuse=String(rules.excuse);
    if(rules.minutes) metadata.minutes=String(rules.minutes);
    const sessionParams={
      mode:'payment',
      success_url:`${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${origin}/checkout.html?canceled=1`,
      customer_email: email,
      line_items: lineItems,
      allow_promotion_codes: true,
      metadata
    };
    if(promoId){
      
      // updated fallback
sessionParams.discounts=[{ promotion_code: promoId }];
    }
    const session=await stripe.checkout.sessions.create(sessionParams);
    return j(200,{url: session.url});
  }catch(err){
    return j(500,{error:err.message||String(err)});
  }
};
