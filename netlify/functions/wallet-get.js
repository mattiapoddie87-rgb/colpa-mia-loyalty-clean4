// netlify/functions/wallet-get.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});

  try{
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    if(!email) return json(400,{error:'missing_email'});

    const search = await stripe.customers.search({ query: `email:'${email}'`, limit: 1 });
    const wallet = search.data.length
      ? parseInt(search.data[0].metadata?.wallet_minutes || '0', 10) || 0
      : 0;

    return json(200,{ wallet });
  }catch(e){
    console.error('wallet_get_error', e);
    return json(500,{error:'wallet_get_failed'});
  }
};
