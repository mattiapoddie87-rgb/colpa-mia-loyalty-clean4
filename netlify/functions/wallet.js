// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Calcola minuti + punti (1 punto = 1 minuto) per una email,
 * sommando le Checkout Sessions 'paid' del Customer trovato.
 * Restituisce anche la spesa totale e una 'tier' in base ai punti.
 */
exports.handler = async (event) => {
  try{
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    if(!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email richiesta' }) };
    if(!process.env.STRIPE_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Stripe non configurato' }) };

    // 1) Cerca Customer per email
    const customers = await stripe.customers.search({ query: `email:'${email}'`, limit: 1 });
    const customer = customers.data[0];
    if(!customer){
      return { statusCode: 200, body: JSON.stringify({ total_minutes: 0, points: 0, total_spent_eur: 0, tier: 'Nessun livello', history: [] }) };
    }

    // 2) Prendi sessions pagate
    const sessions = await stripe.checkout.sessions.list({ customer: customer.id, limit: 100 });
    let totalMin = 0, totalAmt = 0;
    const history = [];
    for(const s of sessions.data){
      if(s.payment_status === 'paid'){
        const minutes = Number(s.metadata?.minutes || 0);
        totalMin += minutes;
        totalAmt += (s.amount_total || 0);
        history.push({
          id: s.id,
          purchased_minutes: minutes,
          amount_total_eur: (s.amount_total||0)/100,
          created: s.created,
          status: s.payment_status
        });
      }
    }
    history.sort((a,b)=>b.created-a.created);

    const points = totalMin; // 1 punto = 1 minuto
    const tier = points>=500 ? 'Platinum' : points>=200 ? 'Gold' : points>=80 ? 'Silver' : points>0 ? 'Bronze' : 'Nessun livello';

    return { statusCode: 200, body: JSON.stringify({
      total_minutes: totalMin,
      points,
      total_spent_eur: (totalAmt/100),
      tier,
      history
    })};
  }catch(e){
    console.error('wallet error', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
