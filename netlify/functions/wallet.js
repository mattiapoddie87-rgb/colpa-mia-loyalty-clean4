// netlify/functions/wallet.js
// Saldo minuti per email: ricalcolo da Checkout Sessions (paid e no_payment_required)
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}};
function readJsonEnv(k){try{return JSON.parse(process.env[k]||'{}')}catch{return{}}}
const RULES = readJsonEnv('PRICE_RULES_JSON');

async function listItems(sessionId){
  try{
    return await stripe.checkout.sessions.listLineItems(sessionId,{limit:100, expand:['data.price.product']});
  }catch{ return {data:[]}; }
}
async function minutesFromSession(s){
  const items = await listItems(s.id);
  let sum=0;
  for (const li of (items.data||[])){
    const qty = li?.quantity||1;
    const priceId = li?.price?.id;
    if (priceId && RULES[priceId]){ sum += Number(RULES[priceId].minutes||0)*qty; continue; }
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1||m2)*qty;
  }
  return sum;
}

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  const email = String((event.queryStringParameters||{}).email||'').trim().toLowerCase();
  if (!email) return j(400,{error:'missing_email'});

  try{
    // trova/crea il Customer
    let customer=null;
    try{
      const res = await stripe.customers.search({ query:`email:"${email}"`, limit:1 });
      customer = res?.data?.[0]||null;
    }catch{}

    if (!customer){
      return j(200,{ ok:true, email, minutes:0, orders:0, level:'Base', points:0 });
    }

    // ricalcola minuti da tutte le sessions complete (paid o gratis)
    let minutes=0, orders=0;
    let starting_after = null;

    do{
      const params = { limit:100, customer: customer.id };
      if (starting_after) params.starting_after = starting_after;
      const page = await stripe.checkout.sessions.list(params);
      for (const s of (page.data||[])){
        const ok = (s.status==='complete') && (s.payment_status==='paid' || s.payment_status==='no_payment_required');
        if (!ok) continue;
        minutes += await minutesFromSession(s);
        orders += 1;
      }
      starting_after = page.has_more ? page.data[page.data.length-1].id : null;
    }while(starting_after);

    const level  = minutes>=180 ? 'Gold' : minutes>=60 ? 'Silver' : 'Base';
    const points = minutes; // 1 punto = 1 minuto
    return j(200,{ ok:true, email, minutes, orders, level, points });
  }catch(e){
    return j(500,{ error:'wallet_error', detail:String(e?.message||e) });
  }
};
