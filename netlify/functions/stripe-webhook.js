// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const j = (s,b) => ({ statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) });

function readJsonEnv(key){ try{ return JSON.parse(process.env[key]||'{}'); }catch{ return {}; } }
const RULES = readJsonEnv('PRICE_RULES_JSON'); // { SKU or priceId -> {minutes,...} }
const POINTS_PER_MINUTE = 1;

function minutesForLine(li){
  // tenta in quest’ordine: price.lookup_key, price.id, session.metadata.sku (passata in line_items singolo)
  const sku = li?.price?.lookup_key || '';
  const pid = li?.price?.id || '';
  if (RULES[sku]?.minutes)   return Number(RULES[sku].minutes)   * (li.quantity||1);
  if (RULES[pid]?.minutes)   return Number(RULES[pid].minutes)   * (li.quantity||1);
  return 0;
}

exports.handler = async (event) => {
  try{
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return j(400,{error:'missing signature'});
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const ev = stripe.webhooks.constructEvent(event.body, sig, whSecret);

    if (ev.type !== 'checkout.session.completed') return j(200,{received:true,ignored:ev.type});

    const session = ev.data.object;
    if (session.mode !== 'payment') return j(200,{received:true,ignored:'not_payment'});

    const piId = String(session.payment_intent||'');
    if (!piId) return j(400,{error:'missing payment_intent'});

    // idempotenza semplice
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.cmCredited === 'true') return j(200,{ok:true,already:true});

    const customerId = session.customer || pi.customer;
    if (!customerId) return j(200,{ok:true,ignored:'no_customer'});

    // calcolo minuti dal carrello
    const items = await stripe.checkout.sessions.listLineItems(session.id,{limit:100, expand:['data.price']});
    let minutes = 0;
    for (const li of items.data) minutes += minutesForLine(li);
    if (minutes <= 0) return j(200,{ok:true,ignored:'no_minutes_matched'});

    // leggi customer e somma
    const cust = await stripe.customers.retrieve(customerId);
    const meta = cust.metadata || {};
    const prevMin = Number(meta.cm_minutes || 0) || 0;
    const prevPts = Number(meta.cm_points  || 0) || 0;
    const prevOrd = Number(meta.cm_orders  || 0) || 0;

    const newMin = prevMin + minutes;
    const newPts = prevPts + (minutes * POINTS_PER_MINUTE);
    const newOrd = prevOrd + 1;

    // livello semplice in base ai punti
    const level = newPts >= 200 ? 'Gold' : newPts >= 80 ? 'Silver' : 'Base';

    await stripe.customers.update(customerId, {
      metadata: {
        ...meta,
        cm_minutes: String(newMin),
        cm_points:  String(newPts),
        cm_orders:  String(newOrd),
        cm_level:   level,
        cm_last_at: new Date().toISOString()
      }
    });

    // marca il PI per evitare doppi accrediti
    await stripe.paymentIntents.update(piId, {
      metadata: { ...(pi.metadata||{}), cmCredited:'true', cmMinutesAdded:String(minutes) }
    });

    return j(200,{ok:true, minutesAdded:minutes, customer:customerId});
  }catch(err){
    return j(500,{error:String(err?.message||'webhook_error')});
  }
};
