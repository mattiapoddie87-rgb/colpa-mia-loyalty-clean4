// netlify/functions/wallet-get.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

// Stesso store in-memory del webhook
const mem = globalThis.__WALLETS__ ||= new Map();

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  if (event.httpMethod !== 'GET')    return json(405,{error:'method_not_allowed'});

  try{
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    if (!email) return json(400,{error:'missing_email'});

    const wallet = parseInt(mem.get(email) || 0, 10) || 0;
    return json(200,{ ok:true, wallet });
  }catch(e){
    return json(500,{error:'wallet_get_failed', detail:String(e.message || e)});
  }
};
