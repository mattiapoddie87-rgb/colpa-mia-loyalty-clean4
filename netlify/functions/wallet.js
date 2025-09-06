// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type' };
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}};

function parseRules(){ try{return JSON.parse(process.env.PRICE_RULES_JSON||'{}');}catch{return{};} }

async function minutesFromLineItems(session){
  const rules = parseRules();
  const items = await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum = 0;
  for (const li of (items.data||[])){
    const qty = li?.quantity || 1;
    const pid = li?.price?.id;
    if (pid && rules[pid]) { sum += Number(rules[pid].minutes||0)*qty; continue; }
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

  // prendo le ultime 100 sessioni e filtro per email
  const sess = await stripe.checkout.sessions.list({ limit:100 }).catch(()=>({data:[]}));
  const mine = (sess.data||[]).filter(s =>
    (s.payment_status==='paid' && s.status==='complete') &&
    ((pick(s,'customer_details.email','')||'').toLowerCase()===email)
  );

  let minutes=0, orders=0;
  for (const s of mine){
    const piId = String(s.payment_intent||'');
    let add = 0;
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
    minutes += add;
    orders += 1;
  }

  const level = (m=>{
    if (m>=180) return 'Gold';
    if (m>=60)  return 'Silver';
    return 'Base';
  })(minutes);

  return j(200,{ ok:true, email, minutes, orders, level });
};
