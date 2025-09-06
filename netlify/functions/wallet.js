// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY,{ apiVersion:'2024-06-20' });

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } };
function parseRules(){ try{ return JSON.parse(process.env.PRICE_RULES_JSON||'{}'); }catch{ return {}; } }

async function minutesFromLineItems(session){
  const rules=parseRules();
  const it = await stripe.checkout.sessions.listLineItems(session.id,{limit:100,expand:['data.price.product']}).catch(()=>({data:[]}));
  let sum=0;
  for(const li of (it.data||[])){
    const qty=li?.quantity||1, priceId=li?.price?.id;
    if(priceId && rules[priceId]){ sum+=Number(rules[priceId].minutes||0)*qty; continue; }
    const m1=Number(pick(li,'price.metadata.minutes',0))||0;
    const m2=Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1||m2)*qty;
  }
  return sum;
}

exports.handler = async (event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  const email = String((event.queryStringParameters||{}).email||'').trim().toLowerCase();
  if(!email) return j(400,{error:'missing_email'});

  try{
    // 1) trova Customer per email
    const s = await stripe.customers.search({ query:`email:"${email}"`, limit:1 });
    const customer = s?.data?.[0]; if(!customer) return j(200,{ok:true,email,minutes:0,orders:0,level:'Base'});

    // 2) somma dai Checkout Sessions (paid OPPURE no_payment_required)
    let minutes=0, orders=0, starting_after=null;
    do{
      const list = await stripe.checkout.sessions.list({ limit:100, customer:customer.id, starting_after });
      for(const cs of (list.data||[])){
        const ok = (cs.status==='complete') && (cs.payment_status==='paid' || cs.payment_status==='no_payment_required');
        if(!ok) continue;
        minutes += await minutesFromLineItems(cs);
        orders++;
      }
      starting_after = list?.data?.length ? list.data[list.data.length-1].id : null;
    }while(starting_after);

    const level = minutes>=180 ? 'Gold' : minutes>=60 ? 'Silver' : 'Base';
    return j(200,{ok:true,email,minutes,orders,level});
  }catch(e){
    return j(500,{error:'wallet_error',detail:String(e?.message||e)});
  }
};
