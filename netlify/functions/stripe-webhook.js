// netlify/functions/stripe-webhook.js
// Accredita minuti/punti leggendo le regole da PRICE_RULES_JSON.
// Match per priorità: lookup_key (SKU) -> price.id.
// Aggrega sul Customer della sessione (o, in fallback, via email).

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function levelFromPoints(p) {
  if (p >= 300) return 'Platinum';
  if (p >= 150) return 'Gold';
  if (p >= 80)  return 'Silver';
  return 'Base';
}

exports.handler = async (event) => {
  try {
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return resp(400, { error: 'missing_signature' });

    const whsec = process.env.STRIPE_WEBHOOK_SECRET;
    const evt = stripe.webhooks.constructEvent(event.body, sig, whsec);

    if (evt.type !== 'checkout.session.completed') {
      return resp(200, { ok: true, ignored: evt.type });
    }

    const session = evt.data.object;
    if (session.mode !== 'payment') return resp(200, { ok: true, ignored: 'not_payment' });

    // Line items
    const items = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ['data.price.product']
    });

    // Regole
    let RULES = {};
    try { RULES = JSON.parse(process.env.PRICE_RULES_JSON || '{}'); } catch { RULES = {}; }

    let minutes = 0;
    let productTag = '';
    const notMatched = [];

    for (const li of items.data) {
      const priceId   = li?.price?.id || '';
      const lookupKey = li?.price?.lookup_key || '';
      const rule = RULES[lookupKey] || RULES[priceId];

      if (rule) {
        minutes += (n(rule.minutes) * (li.quantity || 1)) || 0;
        if (!productTag && rule.excuse) productTag = String(rule.excuse);
      } else {
        notMatched.push({ priceId, lookupKey });
      }
    }

    // Customer
    let customerId = session.customer || '';
    if (!customerId) {
      // fallback via email
      const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
      if (email) {
        const list = await stripe.customers.list({ email, limit: 1 });
        if (list.data[0]) customerId = list.data[0].id;
      }
    }
    if (!customerId) return resp(200, { ok: true, minutes, note: 'no_customer' });

    // Somma minuti/punti nel metadata del Customer
    const customer = await stripe.customers.retrieve(customerId);
    const metaOld = customer.metadata || {};
    const oldMin  = n(metaOld.cm_minutes, 0);
    const oldPts  = n(metaOld.cm_points,  0);

    const addMin  = Math.max(0, minutes);
    const addPts  = addMin; // 1 punto = 1 minuto (puoi cambiare la logica qui)

    const newMin  = oldMin + addMin;
    const newPts  = oldPts + addPts;
    const newLvl  = levelFromPoints(newPts);

    await stripe.customers.update(customerId, {
      metadata: {
        ...metaOld,
        cm_minutes: String(newMin),
        cm_points:  String(newPts),
        cm_level:   newLvl,
        cm_last_session: session.id,
        cm_last_excuse_tag: productTag || '',
        ...(notMatched.length ? { cm_notMatched: JSON.stringify(notMatched).slice(0, 500) } : {})
      }
    });

    return resp(200, { ok: true, minutesAdded: addMin, pointsAdded: addPts, level: newLvl, notMatched });
  } catch (err) {
    return resp(500, { error: String(err?.message || err) });
  }
};
