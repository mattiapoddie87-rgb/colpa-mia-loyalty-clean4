// netlify/functions/balance.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b,h={}) => ({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS, ...h}, body:JSON.stringify(b) });

const levelFromPoints = (pts) => (pts>=200?'Elite':pts>=100?'Pro':pts>=50?'Plus':'Base');

async function findOrCreateCustomer(email){
  const list = await stripe.customers.list({ email, limit: 1 });
  return list.data[0] || await stripe.customers.create({ email });
}

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{ error:'bad_json' }); }
  const email = String(body.email||'').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j(400,{ error:'invalid_email' });

  try{
    const c = await findOrCreateCustomer(email);
    const md = c.metadata || {};
    const minutes = parseInt(md.cm_minutes||'0',10)||0;
    const points  = parseInt(md.cm_points ||'0',10)||0;
    return j(200, { ok:true, minutes, points, level: levelFromPoints(points) });
  }catch(e){
    return j(500,{ error:String(e?.message||'balance_error') });
  }
};
