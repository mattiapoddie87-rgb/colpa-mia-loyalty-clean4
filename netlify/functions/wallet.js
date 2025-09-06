// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'GET')   return j(405, { error: 'method_not_allowed' });

  const email = String((event.queryStringParameters || {}).email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j(400, { error: 'invalid_email' });

  try {
    let customers = [];

    // 1) Prova Customer Search (supporta query per email)
    try {
      const res = await stripe.customers.search({
        query: `email:"${email}"`,
        limit: 100,
      });
      customers = res.data || [];
    } catch (e) {
      // 2) Fallback: customers.list(email)
      let starting_after = null;
      do {
        const page = await stripe.customers.list({ email, limit: 100, starting_after });
        customers = customers.concat(page.data || []);
        starting_after = page.has_more ? page.data[page.data.length - 1].id : null;
      } while (starting_after);
    }

    // Aggrega i meta di tutti i customer omonimi
    let minutes = 0, points = 0, orders = 0, last = null;
    for (const c of customers) {
      const m = c.metadata || {};
      minutes += Number(m.cm_minutes || 0) || 0;
      points  += Number(m.cm_points  || 0) || 0;
      orders  += Number(m.cm_orders  || 0) || 0;
      if (m.cm_last_at && (!last || m.cm_last_at > last)) last = m.cm_last_at;
    }

    const level = points >= 200 ? 'Gold' : points >= 80 ? 'Silver' : 'Base';
    return j(200, { ok: true, email, minutes, points, orders, level, last });
  } catch (err) {
    return j(500, { error: String(err?.message || 'wallet_error') });
  }
};
