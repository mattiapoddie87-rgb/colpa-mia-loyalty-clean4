// Ritorna minuti totali per un'email, sommando su tutti i Customer con quell'email.
// Richiede: STRIPE_SECRET_KEY
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'GET') return j(405,{error:'method_not_allowed'});

  const email = String(event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email) return j(400,{error:'missing_email'});

  try {
    let total = 0;
    let hasAny = false;

    let res = await stripe.customers.search({ query: `email:"${email}"`, limit: 100 });
    while (true) {
      for (const c of res.data) {
        hasAny = true;
        const m = Number(c?.metadata?.cm_minutes || 0) || 0;
        total += m;
      }
      if (!res.has_more) break;
      res = await stripe.customers.search({ query: `email:"${email}"`, limit: 100, page: res.next_page });
    }

    // Semplice livello
    const level = total >= 150 ? 'Gold' : total >= 80 ? 'Silver' : 'Base';

    return j(200, { ok:true, email, minutes: total, points: total, level, hasCustomer: hasAny });
  } catch (err) {
    return j(500, { error: String(err?.message || 'wallet_error') });
  }
};
