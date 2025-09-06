// netlify/functions/wallet.js
// Restituisce saldo aggregato su TUTTI i Customer con la stessa email.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

function r(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function levelFromPoints(p) {
  if (p >= 300) return 'Platinum';
  if (p >= 150) return 'Gold';
  if (p >= 80)  return 'Silver';
  return 'Base';
}

exports.handler = async (event) => {
  try {
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    if (!email) return r(400, { error: 'missing_email' });

    // Trova tutti i customers per email
    const customers = await stripe.customers.list({ email, limit: 100 });

    let minutes = 0, points = 0;
    let level = 'Base';
    const collectors = [];

    for (const c of customers.data) {
      const m = c.metadata || {};
      const cm = n(m.cm_minutes, 0);
      const cp = n(m.cm_points,  0);
      minutes += cm;
      points  += cp;
      collectors.push({ id: c.id, cm_minutes: cm, cm_points: cp, cm_level: m.cm_level || '' });
    }

    // livello aggregato
    const aggLevel = levelFromPoints(points);
    level = aggLevel;

    return r(200, { email, minutes, points, level, collectors });
  } catch (e) {
    return r(500, { error: String(e?.message || e) });
  }
};
