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
  BASE_FREE: { cost: 50,  percent_off: 100, name: 'Base GRATIS' },
  DELUXE_50:{ cost: 80,  percent_off: 50,  name: 'Deluxe -50%' }
};

function randCode() {
  return 'COLPA-' +
    Math.random().toString(36).slice(2,6).toUpperCase() +
    '-' +
    Date.now().toString(36).slice(-4).toUpperCase();
}

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  try{
    const { email, reward } = JSON.parse(event.body || '{}');
    if(!email || !reward) return json(400,{error:'missing_params'});

    const r = REWARDS[reward];
    if(!r) return json(400,{error:'unknown_reward'});

    const em = String(email).trim().toLowerCase();
    const search = await stripe.customers.search({ query: `email:'${em}'`, limit: 1 });
    if(!search.data.length) return json(404,{error:'customer_not_found'});

    const cust = search.data[0];
    const current = parseInt(cust.metadata?.wallet_minutes || '0', 10) || 0;
    if(current < r.cost) return json(400,{error:'not_enough_minutes', current });

    // crea coupon + promotion code
    const coupon = await stripe.coupons.create({
      percent_off: r.percent_off,
      duration: 'once',
      name: r.name
    });

    const code = randCode();
    const promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code,
      active: true,
      max_redemptions: 1,
      restrictions: { first_time_transaction: false }
    });

    const remaining = current - r.cost;
    await stripe.customers.update(cust.id, {
      metadata: { ...cust.metadata, wallet_minutes: String(remaining) }
    });

    return json(200,{ promo_code: promo.code, remaining });
  }catch(e){
    console.error('wallet_redeem_error', e);
    return json(500,{error:'redeem_failed'});
  }
};
