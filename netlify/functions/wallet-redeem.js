// netlify/functions/wallet-redeem.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

// Semplice store in memoria (sostituisci con KV/DB se vuoi persistenza)
const mem = globalThis.__WALLETS__ ||= new Map();

const REWARDS = {
  BASE_FREE:  { cost: 50, promo_code: 'SCUSA_BASE_100' }, // codice fittizio; sostituisci con i tuoi promo reali
  DELUXE_50:  { cost: 80, promo_code: 'DELUXE_50_OFF'   }
};

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  if (event.httpMethod !== 'POST')   return json(405,{error:'method_not_allowed'});

  try{
    const { email, reward } = JSON.parse(event.body || '{}');
    if (!email || !reward) return json(400,{error:'missing_params'});

    const r = REWARDS[reward];
    if (!r) return json(400,{error:'unknown_reward'});

    const current = parseInt(mem.get(email) || 0, 10) || 0;
    const cost    = parseInt(r.cost, 10);

    if (current < cost) return json(400,{error:'not_enough_minutes', have: current, need: cost});

    const remaining = current - cost;
    mem.set(email, remaining);

    return json(200, {
      ok: true,
      promo_code: r.promo_code,
      remaining
    });
  }catch(e){
    return json(500,{error:'redeem_failed', detail:String(e.message || e)});
  }
};
