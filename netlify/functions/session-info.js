// netlify/functions/session-info.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

const TITLE = {
  SCUSA_BASE:    'Scusa Base',
  SCUSA_DELUXE:  'Scusa Deluxe',
  CONNESSIONE:   'Connessione KO',
  TRAFFICO:      'Traffico',
  RIUNIONE:      'Riunione Improvvisa',
  COLPA_LIGHT:   'Prendo io la colpa — Light',
  COLPA_FULL:    'Prendo io la colpa — Full',
  COLPA_DELUXE:  'Prendo io la colpa — Deluxe'
};

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  try{
    const id = (event.queryStringParameters?.id || '').trim();
    if(!id) return json(400,{error:'missing_id'});

    const sess = await stripe.checkout.sessions.retrieve(id);

    const sku   = sess.client_reference_id || sess.metadata?.sku || '';
    const title = TITLE[sku] || (sku ? sku : 'Prodotto');
    const email = sess.customer_details?.email || '';
    const amount = typeof sess.amount_total === 'number' ? sess.amount_total : null;
    const currency = (sess.currency || '').toUpperCase();

    return json(200,{
      id: sess.id,
      sku,
      title,
      email,
      amount_total: amount,   // in centesimi
      currency
    });
  }catch(e){
    return json(500,{error:'lookup_failed', detail:String(e.message||e)});
  }
};
