// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b) => ({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'GET')     return j(405,{ error:'method_not_allowed' });

  const q = event.queryStringParameters || {};
  const email = String(q.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j(400,{ error:'invalid_email' });

  try {
    const list = await stripe.customers.list({ email, limit: 5 });
    const customer =
      list.data.find(c => (c.email||'').toLowerCase() === email) ||
      list.data[0] || null;

    if (!customer) {
      return j(200, { ok:true, email, minutes:0, points:0, level:'Base' });
    }

    const md = customer.metadata || {};
    const minutes = parseInt(md.cm_minutes || '0', 10) || 0;
    const points  = parseInt(md.cm_points  || '0', 10) || 0;

    // Livello semplice sui punti
    let level = 'Base';
    if (points >= 300) level = 'Elite';
    else if (points >= 150) level = 'Pro';
    else if (points >= 60)  level = 'Plus';

    return j(200, { ok:true, email, minutes, points, level });
  } catch (err) {
    return j(500, { error:String(err?.message || 'wallet_error') });
  }
};
