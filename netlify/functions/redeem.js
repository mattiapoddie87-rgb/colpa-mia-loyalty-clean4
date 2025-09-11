// netlify/functions/wallet-redeem.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const res = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

// Ricompense
const REWARDS = {
  BASE_FREE: { cost: 50, coupon: { percent_off: 100, duration: 'once' } },
  DELUXE_50:{ cost: 80, coupon: { percent_off: 50,  duration: 'once' } },
};
const genCode = (p='COLPA') => `${p}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return res(204, {});
  try {
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim().toLowerCase();
    const rewardKey = String(body.reward || '').toUpperCase();
    if (!email || !REWARDS[rewardKey]) return res(400, { error: 'bad_request' });

    const list = await stripe.customers.list({ email, limit: 1 });
    const cust = list.data?.[0];
    if (!cust) return res(404, { error: 'customer_not_found' });

    const current = Number(cust.metadata?.walletMinutes || 0) || 0;
    const need = REWARDS[rewardKey].cost;
    if (current < need) return res(400, { error: 'insufficient_minutes', have: current, need });

    const coupon = await stripe.coupons.create(REWARDS[rewardKey].coupon);
    const promo  = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: genCode(),
      max_redemptions: 1,
      expires_at: Math.floor(Date.now()/1000) + 60*60*24*14, // 14 giorni
    });

    const remaining = current - need;
    await stripe.customers.update(cust.id, { metadata: { walletMinutes: String(remaining) } });

    return res(200, { ok: true, reward: rewardKey, promo_code: promo.code, remaining });
  } catch (e) {
    return res(500, { error: 'wallet_redeem_failed', detail: String(e.message || e) });
  }
};
