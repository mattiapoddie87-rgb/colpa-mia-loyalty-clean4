// netlify/functions/wallet-get.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const res = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return res(204, {});
  try {
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    if (!email) return res(400, { error: 'missing_email' });

    const list = await stripe.customers.list({ email, limit: 1 });
    const cust = list.data?.[0];
    const wallet = Number(cust?.metadata?.walletMinutes || 0) || 0;

    return res(200, { email, wallet });
  } catch (e) {
    return res(500, { error: 'wallet_get_failed', detail: String(e.message || e) });
  }
};
