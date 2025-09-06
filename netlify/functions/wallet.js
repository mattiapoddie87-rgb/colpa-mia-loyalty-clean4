// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}};
function parseRules(){ try{return JSON.parse(process.env.PRICE_RULES_JSON||'{}');}catch{return{};} }

async function minutesFromLineItems(session){
  const rules=parseRules();
  const items = await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum=0;
  for (const li of (items.data||[])){
    const qty=li?.quantity||1, pid=li?.price?.id;
    if (pid && rules[pid]){ sum += Number(rules[pid].minutes||0)*qty; continue; }
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

  // 1) Trova/crea il Customer per email
  let customer=null;
  try{
    const res = await stripe.customers.search({ query: `email:"${email}"`, limit:1 });
    customer = res?.data?.[0] || null;
  }catch{}
  if (!customer){
    // nessun customer → niente acquisti tracciati
    return j(200,{ ok:true, email, minutes:0, orders:0, level:'Base' });
  }

  // 2) Se c'è il contatore persistito, usalo
  const persisted = Number(customer?.metadata?.wallet_minutes||0) || 0;

  // 3) Fallback: ricalcola dai Checkout Sessions del customer (promo code compresi)
  let recomputed = 0, orders = 0;
  try{
    const list = await stripe.checkout.sessions.list({ limit: 100, customer: customer.id });
    for (const s of (list.data||[])){
      const ok = (s.status==='complete') && (s.payment_status==='paid' || s.payment_status==='no_payment_required');
      if (!ok) continue;
      let add = 0;
      const piId = String(s.payment_intent||'');
      if (piId){
        try{
          const pi = await stripe.paymentIntents.retrieve(piId);
          add = Number(pi?.metadata?.minutesCredited||0) || 0;
          if (!add) add = await minutesFromLineItems(s);
        }catch{
          add = await minutesFromLineItems(s);
        }
      }else{
        add = await minutesFromLineItems(s);
      }
      recomputed += add;
      orders += 1;
    }
  }catch{}

  const minutes = Math.max(persisted, recomputed); // most reliable
  const level = minutes>=180 ? 'Gold' : minutes>=60 ? 'Silver' : 'Base';
  return j(200,{ ok:true, email, minutes, orders, level });
};
