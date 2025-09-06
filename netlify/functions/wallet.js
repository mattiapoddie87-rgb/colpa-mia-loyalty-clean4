// netlify/functions/wallet.js
// Restituisce saldo aggregato su TUTTI i Customer Stripe con la stessa email.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const json = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) });
const num  = (v,d=0)=>{ const x=Number(v); return Number.isFinite(x)?x:d; };
const levelFromPoints = (p)=> p>=300?'Platinum' : p>=150?'Gold' : p>=80?'Silver' : 'Base';

exports.handler = async (event) => {
  try{
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    if(!email) return json(400,{ ok:false, error:'missing_email' });

    // Prendi tutti i customers con quella email (somma i metadata)
    const customers = await stripe.customers.list({ email, limit:100 });

    let minutes = 0, points = 0;
    const collectors = [];
    for(const c of customers.data){
      const m = c.metadata || {};
      const cm = num(m.cm_minutes,0);
      const cp = num(m.cm_points,0);
      minutes += cm;
      points  += cp;
      collectors.push({ id:c.id, cm_minutes:cm, cm_points:cp, cm_level:m.cm_level||'' });
    }

    const level = levelFromPoints(points);
    return json(200,{ ok:true, email, minutes, points, level, collectors });
  }catch(err){
    return json(500,{ ok:false, error:String(err?.message||err) });
  }
};
