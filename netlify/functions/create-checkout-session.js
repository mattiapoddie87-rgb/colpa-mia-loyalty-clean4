const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
function parseEnvJSON(name){try{return JSON.parse(process.env[name]||'{}')}catch{return {}}}
const PRICE_BY_SKU=parseEnvJSON('PRICE_BY_SKU_JSON');
const PRICE_RULES=parseEnvJSON('PRICE_RULES_JSON');
const ALIAS={BASE_5:'COLPA_LIGHT',BASE_15:'COLPA_FULL',PREMIUM_30:'COLPA_DELUXE'};

exports.handler=async(e)=>{
  if(e.httpMethod==='OPTIONS') return j(204,{});
  if(e.httpMethod!=='POST') return j(405,{error:'Method not allowed'});
  if(!process.env.STRIPE_SECRET_KEY) return j(500,{error:'STRIPE_SECRET_KEY mancante'});
  if(!Object.keys(PRICE_BY_SKU).length) return j(500,{error:'PRICE_BY_SKU_JSON mancante'});
  try{
    const {sku:rawSku,email,title,context,message,tone}=JSON.parse(e.body||'{}');
    if(!rawSku||!email) return j(400,{error:'sku ed email obbligatori'});
    const sku=PRICE_BY_SKU[rawSku]?rawSku:(ALIAS[rawSku]||rawSku);
    const priceId=PRICE_BY_SKU[sku]; if(!priceId) return j(400,{error:`SKU non mappato: ${rawSku}`});
    const rules=PRICE_RULES[sku]||{};
    const origin=e.headers.origin||process.env.SITE_URL||'https://colpamia.com';

    const form=new URLSearchParams();
    form.append('mode','payment');
    form.append('success_url', `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    form.append('cancel_url', `${origin}/checkout.html?canceled=1`);
    form.append('customer_email', email);
    form.append('payment_intent_data[receipt_email]', email);
    form.append('line_items[0][price]', priceId);
    form.append('line_items[0][quantity]','1');
    if(title)   form.append('metadata[title]', title);
    if(context) form.append('metadata[context]', context);
    if(message) form.append('metadata[message]', message);
    if(tone)    form.append('metadata[tone]', tone);
    form.append('metadata[sku]', sku);
    if(rules.excuse)  form.append('metadata[excuse]', String(rules.excuse));
    if(rules.minutes) form.append('metadata[minutes]', String(rules.minutes));

    const resp=await fetch('https://api.stripe.com/v1/checkout/sessions',{
      method:'POST',
      headers:{'Authorization':`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:form.toString()
    });
    const data=await resp.json();
    if(!resp.ok) return j(resp.status,{error:data.error?.message||'Stripe error'});
    return j(200,{url:data.url});
  }catch(err){return j(500,{error:err.message||String(err)})}
};
