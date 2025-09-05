// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
function http(s,b){ return {statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)} }

exports.handler = async (event)=>{
  try{
    const email = (event.queryStringParameters?.email || '').toLowerCase().trim();
    if (!email) return http(400,{error:'missing_email'});

    // Cerca PIs live con metadato impostato dal webhook
    const q = `status:'succeeded' AND metadata['colpamiaEmail']:'${email.replace(/'/g,"\\'")}'`;
    let next = null, minutes = 0;

    do {
      const r = await stripe.paymentIntents.search({ query: q, limit: 100, page: next || undefined });
      for (const pi of r.data) {
        const m = Number(pi.metadata?.minutesCredited || 0);
        if (!Number.isNaN(m)) minutes += m;
      }
      next = r.next_page;
    } while (next);

    return http(200,{ ok:true, email, minutes, points: minutes, level: (minutes>=120?'Deluxe':minutes>=60?'Plus':'None') });
  }catch(e){
    return http(500,{error:String(e?.message||'wallet_error')});
  }
};
