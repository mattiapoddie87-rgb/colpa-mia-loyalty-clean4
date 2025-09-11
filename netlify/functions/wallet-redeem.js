// netlify/functions/wallet-redeem.js
import Stripe from 'stripe';
import { get, set } from '@netlify/blobs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const STORE = 'colpamia';
const KEY   = 'wallets.json';

const REWARDS = {
  // Riscatta 50 minuti → coupon 100% (1 uso)
  BASE_FREE:  { cost: 50, coupon: { percent_off: 100, duration: 'once' } },
  // Riscatta 80 minuti → coupon -50% (1 uso)
  DELUXE_50: { cost: 80, coupon: { percent_off: 50,  duration: 'once' } },
};

async function loadWallets() {
  return (await get({ name: KEY, type: 'json', store: STORE })) || {};
}
async function saveWallets(w) {
  await set({
    name: KEY,
    data: JSON.stringify(w),
    store: STORE,
    contentType: 'application/json'
  });
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { /* ignore */ }

  const email  = (payload.email || '').trim().toLowerCase();
  const reward = String(payload.reward || '');
  const def    = REWARDS[reward];

  if (!email || !def) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad_request' }) };
  }

  const wallets = await loadWallets();
  const current = Number(wallets[email] || 0);
  const cost    = Number(def.cost);

  if (isNaN(current) || current < cost) {
    return { statusCode: 400, body: JSON.stringify({ error: 'not_enough_minutes', current }) };
  }

  // Crea coupon e promotion code una-tantum
  const coupon = await stripe.coupons.create(def.coupon);
  const promo  = await stripe.promotionCodes.create({
    coupon: coupon.id,
    max_redemptions: 1,
    active: true
  });

  wallets[email] = current - cost;
  await saveWallets(wallets);

  return {
    statusCode: 200,
    body: JSON.stringify({ promo_code: promo.code, remaining: wallets[email] })
  };
};
