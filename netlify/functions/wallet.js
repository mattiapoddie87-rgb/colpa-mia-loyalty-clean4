// netlify/functions/wallet.js
// Mostra saldo minuti ricavando i PaymentIntent per email (funziona anche con guest)

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  const email = String((event.queryStringParameters||{}).email||'').trim().toLowerCase();
  if (!email) return j(400,{error:'missing_email'});

  try {
    // Cerco tutti i PaymentIntent chiusi con metadata.customerEmail == email
    // NB: PaymentIntents.search supporta query; includiamo solo succeeded
    const q = `status:"succeeded" AND metadata.customerEmail:"${email}"`;
    let minutes = 0, count = 0;
    let next = null;

    do{
      const res = await stripe.paymentIntents.search({ query:q, limit:100, page: next || undefined });
      for (const pi of (res.data||[])) {
        minutes += Number(pi?.metadata?.minutesCredited || 0) || 0;
        count++;
      }
      next = res?.next_page || null;
    }while(next);

    const level = minutes >= 180 ? 'Gold' : minutes >= 60 ? 'Silver' : 'Base';
    return j(200, { ok:true, email, minutes, orders: count, level });
  } catch (e) {
    return j(500, { error:'wallet_error', detail:String(e?.message||e) });
  }
};
