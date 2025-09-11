// netlify/functions/wallet-redeem.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

const REWARDS = {
  BASE_FREE:  { needMinutes: 50, couponEnv: 'STRIPE_COUPON_BASE_FREE'  }, // 100% Base
  DELUXE_50:  { needMinutes: 80, couponEnv: 'STRIPE_COUPON_DELUXE_50' }  // -50% Deluxe
};

function genCode(prefix='CM'){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for(let i=0;i<8;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return `${prefix}-${s}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  if (event.httpMethod !== 'POST')   return json(405,{error:'method_not_allowed'});

  try{
    const { email = '', reward = '' } = JSON.parse(event.body || '{}');
    if (!email || !reward) return json(400,{error:'missing_params'});

    const conf = REWARDS[reward];
    if (!conf) return json(400,{error:'unknown_reward'});

    // trova cliente Stripe per email
    const list = await stripe.customers.list({ email, limit: 1 });
    const cust = list.data[0];
    if (!cust) return json(404,{error:'wallet_not_found'});

    const current = Number(cust.metadata?.wallet_minutes || 0);
    if (current < conf.needMinutes) {
      return json(400,{error:'not_enough_minutes', have: current, need: conf.needMinutes});
    }

    // scala minuti
    const remaining = current - conf.needMinutes;
    await stripe.customers.update(cust.id, {
      metadata: { ...cust.metadata, wallet_minutes: String(Math.max(0, remaining)) }
    });

    // crea Promotion Code dal coupon configurato
    const couponId = process.env[conf.couponEnv];
    if (!couponId) return json(500,{error:'missing_coupon_env', missing: conf.couponEnv});

    const promo = await stripe.promotionCodes.create({
      coupon: couponId,
      code: genCode(reward === 'BASE_FREE' ? 'FREEBASE' : 'DELUXE50'),
      max_redemptions: 1,
      expires_at: Math.floor(Date.now()/1000) + 14*24*60*60 // 14 giorni
    });

    return json(200, { promo_code: promo.code, remaining });
  }catch(e){
    return json(500,{error:'redeem_failed', detail:String(e.message||e)});
  }
};
