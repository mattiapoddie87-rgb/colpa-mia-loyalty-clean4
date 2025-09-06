// netlify/functions/wallet.js
// Saldo minuti per email: prima Customer.metadata.wallet_minutes, poi fallback su Sessions.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{ try{ return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x) ?? d; }catch{ return d; } };

function rules(){ try{ return JSON.parse(process.env.PRICE_RULES_JSON||'{}'); }catch{ return {}; } }

async function minutesFromLineItems(sessionId){
  const r = rules();
  const items = await stripe.checkout.sessions.listLineItems(sessionId,{limit:100,expand:['data.price.product']}).then(r=>r.data||[]).catch(()=>[]);
  let sum=0;
  for (const li of items){
    const q = li.quantity||1;
    const pid = pick(li,'price.id','');
    if (pid && r[pid]) { sum += Number(r[pid].minutes||0)*q; continue; }
    const m1 = Number(pick(li,'price.metadata.minutes',0))||0;
    const m2 = Number(pick(li,'price.product.metadata.minutes',0))||0;
    sum += (m1||m2)*q;
  }
  return sum;
}

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  const email = String((event.queryStringParameters||{}).email||'').trim().toLowerCase();
  if (!email) return j(400,{error:'missing_email'});

  try{
    // 1) Trova customer per email
    const sr = await stripe.customers.search({ query:`email:"${email}"`, limit:1 });
    const customer = sr?.data?.[0] || null;
    if (!customer) return j(200,{ ok:true, email, minutes:0, orders:0, level:'Base' });

    // 2) Preferisci contatore persistito (aggiornato dal webhook)
    const persisted = Number(customer?.metadata?.wallet_minutes||0) || 0;

    // 3) Fallback robusto: somma tutte le sessions complete (anche no_payment_required)
    let recomputed = 0, orders = 0;
    try{
      const list = await stripe.checkout.sessions.list({ limit: 100, customer: customer.id });
      for (const s of (list.data||[])){
        const ok = s.status==='complete' && (s.payment_status==='paid' || s.payment_status==='no_payment_required');
        if (!ok) continue;
        recomputed += await minutesFromLineItems(s.id);
        orders += 1;
      }
    }catch{}

    const minutes = Math.max(persisted, recomputed);
    const level = minutes>=180 ? 'Gold' : minutes>=60 ? 'Silver' : 'Base';
    return j(200,{ ok:true, email, minutes, orders, level });
  }catch(e){
    return j(500,{ error:'wallet_error', detail:String(e?.message||e) });
  }
};
